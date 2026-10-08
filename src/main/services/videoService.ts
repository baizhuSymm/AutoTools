import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { DateRange, Video } from '../../shared/ipc'
import type { ToolResult } from '../../shared/agent'

interface Fingerprint {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}
export interface ScannedVideo extends Video {
  id: string
  fingerprint: Fingerprint
}
export interface Scan {
  id: string
  source: string
  files: ScannedVideo[]
  dateRange: DateRange | null
}
interface MoveItem {
  source: string
  destination: string
  fingerprint: Fingerprint
}
export interface MovePlan {
  target: string
  items: MoveItem[]
}
const extensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'])

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new Error('请选择绝对目录路径')
  return resolve(path)
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonical(parent), basename(path))
  }
}
function equalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
function fingerprint(info: Stats): Fingerprint {
  return { size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }
}
async function unchanged(item: MoveItem): Promise<void> {
  const info = await lstat(item.source)
  if (!info.isFile() || JSON.stringify(fingerprint(info)) !== JSON.stringify(item.fingerprint)) {
    throw new Error(`源文件已变化，请重新扫描并确认：${item.source}`)
  }
}

export async function scan(source: string, range: DateRange | null): Promise<Scan> {
  source = await realpath(absolute(source))
  const start = range?.start ? new Date(`${range.start}T00:00:00`).getTime() : -Infinity
  const end = range?.end ? new Date(`${range.end}T23:59:59.999`).getTime() : Infinity
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new Error('日期区间无效')
  const files: ScannedVideo[] = []
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const folder = join(source, entry.name)
    const folderInfo = await stat(folder)
    if (folderInfo.mtimeMs < start || folderInfo.mtimeMs > end) continue
    for (const file of await readdir(folder, { withFileTypes: true })) {
      if (!file.isFile() || !extensions.has(extname(file.name).toLowerCase())) continue
      const path = join(folder, file.name)
      const info = await lstat(path)
      files.push({
        id: randomUUID(),
        path,
        name: file.name,
        size: info.size,
        mtime: info.mtimeMs,
        folderMtime: folderInfo.mtimeMs,
        fromSubfolder: entry.name,
        fingerprint: fingerprint(info)
      })
    }
  }
  return { id: randomUUID(), source, files, dateRange: range }
}

export async function prepareMove(found: Scan, ids: string[], target: string): Promise<MovePlan> {
  target = await canonical(absolute(target))
  const files = ids.length ? found.files.filter((file) => ids.includes(file.id)) : found.files
  if (!files.length || (ids.length && files.length !== new Set(ids).size))
    throw new Error('文件选择无效，请重新扫描')
  const reserved = new Set<string>()
  const items: MoveItem[] = []
  for (const file of files) {
    let destination = join(target, file.name)
    if (equalPath(await canonical(file.path), destination)) throw new Error('目标文件与源文件相同')
    let suffix = 1
    while ((await exists(destination)) || reserved.has(destination.toLowerCase())) {
      const ext = extname(file.name)
      destination = join(target, `${basename(file.name, ext)}_${suffix++}${ext}`)
    }
    reserved.add(destination.toLowerCase())
    const item = { source: file.path, destination, fingerprint: file.fingerprint }
    await unchanged(item)
    items.push(item)
  }
  return { target, items }
}

export async function executeMove(plan: MovePlan, signal: AbortSignal): Promise<ToolResult> {
  const moved: { source: string; destination: string }[] = []
  const failed: { source: string; destination: string; error: string; copied: boolean }[] = []
  try {
    signal.throwIfAborted()
    if (!equalPath(await canonical(plan.target), plan.target))
      throw new Error('目标目录已变化，请重新确认')
    for (const item of plan.items) {
      await unchanged(item)
      if (await exists(item.destination))
        throw new Error(`目标已被占用，请重新确认：${item.destination}`)
      if (!equalPath(await canonical(item.source), item.source))
        throw new Error('源文件实际路径已变化')
    }
    await mkdir(plan.target, { recursive: true })
    for (const item of plan.items) {
      if (signal.aborted) break
      let copied = false
      try {
        await unchanged(item)
        if (!equalPath(await realpath(plan.target), plan.target)) throw new Error('目标目录已变化')
        await copyFile(item.source, item.destination, constants.COPYFILE_EXCL)
        copied = true
        await unchanged(item)
        await unlink(item.source)
        moved.push({ source: item.source, destination: item.destination })
      } catch (error) {
        failed.push({
          source: item.source,
          destination: item.destination,
          copied,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const cancelled = plan.items.length - moved.length - failed.length
    return {
      status:
        cancelled || failed.length
          ? moved.length
            ? 'partial'
            : cancelled
              ? 'cancelled'
              : 'failed'
          : 'succeeded',
      summary: `移动成功 ${moved.length}，失败 ${failed.length}，未执行 ${cancelled}`,
      data: { moved, failed, cancelled }
    }
  } catch (error) {
    return {
      status: signal.aborted ? 'cancelled' : 'failed',
      summary: signal.aborted
        ? '移动已取消'
        : error instanceof Error
          ? error.message
          : String(error),
      data: { moved, failed }
    }
  }
}
