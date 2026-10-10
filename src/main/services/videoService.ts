import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type { DateRange } from '../../shared/ipc'
import type { ToolResult } from '../../shared/agent'
import type { FileInfo, FileSystemPort } from '../contracts/ports'
import type {
  Fingerprint,
  MovePlan,
  MoveItem,
  Scan,
  ScannedVideo,
  PublicScan,
  ScanPage
} from '../contracts/video'
import { absolute, equalPath } from '../utils/paths'

const extensions = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'])
function fingerprint(info: FileInfo): Fingerprint {
  return { size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }
}
export class VideoService {
  private scans = new Map<string, Scan>()
  constructor(private files: FileSystemPort) {}

  private getScan(id: string): Scan {
    const found = this.scans.get(id)
    if (!found) throw new Error('扫描记录已过期，请重新扫描')
    return found
  }
  results(scanId: string, offset: number, limit: number, query: string): ScanPage {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30 ||
      typeof query !== 'string' ||
      query.length > 256
    )
      throw new Error('分页参数无效')
    const found = this.getScan(scanId)
    const matches = found.files.filter((file) =>
      `${file.name} ${file.fromSubfolder}`.toLowerCase().includes(query.toLowerCase())
    )
    const files = matches
      .slice(offset, offset + limit)
      .map(({ fingerprint: _fingerprint, ...file }) => structuredClone(file))
    return {
      id: found.id,
      files,
      total: matches.length,
      offset,
      nextOffset: offset + files.length < matches.length ? offset + files.length : null
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.files.info(path, false)
      return true
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false
      throw error
    }
  }
  private async canonical(path: string): Promise<string> {
    try {
      return await this.files.realPath(path)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      const parent = dirname(path)
      if (parent === path) throw error
      return join(await this.canonical(parent), basename(path))
    }
  }
  private async unchanged(item: MoveItem): Promise<void> {
    const info = await this.files.info(item.source, false)
    if (
      info.kind !== 'file' ||
      JSON.stringify(fingerprint(info)) !== JSON.stringify(item.fingerprint)
    ) {
      throw new Error(`源文件已变化，请重新扫描并确认：${item.source}`)
    }
  }

  async scan(source: string, range: DateRange | null, signal: AbortSignal): Promise<PublicScan> {
    signal.throwIfAborted()
    source = await this.files.realPath(absolute(source))
    const start = range?.start ? new Date(`${range.start}T00:00:00`).getTime() : -Infinity
    const end = range?.end ? new Date(`${range.end}T23:59:59.999`).getTime() : Infinity
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new Error('日期区间无效')
    const files: ScannedVideo[] = []
    for (const entry of await this.files.readDirectory(source)) {
      if (entry.kind !== 'directory') continue
      const folder = join(source, entry.name)
      const folderInfo = await this.files.info(folder, true)
      if (folderInfo.mtimeMs < start || folderInfo.mtimeMs > end) continue
      for (const file of await this.files.readDirectory(folder)) {
        if (file.kind !== 'file' || !extensions.has(extname(file.name).toLowerCase())) continue
        const path = join(folder, file.name)
        const info = await this.files.info(path, false)
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
    signal.throwIfAborted()
    const found = { id: randomUUID(), source, files, dateRange: range }
    this.scans.set(found.id, found)
    if (this.scans.size > 20) this.scans.delete(this.scans.keys().next().value!)
    return {
      ...found,
      files: files.map(({ fingerprint: _fingerprint, ...file }) => structuredClone(file))
    }
  }

  async prepareMove(scanId: string, ids: string[], target: string): Promise<MovePlan> {
    const found = this.getScan(scanId)
    target = await this.canonical(absolute(target))
    const files = ids.length ? found.files.filter((file) => ids.includes(file.id)) : found.files
    if (!files.length || (ids.length && files.length !== new Set(ids).size))
      throw new Error('文件选择无效，请重新扫描')
    const reserved = new Set<string>()
    const items: MoveItem[] = []
    for (const file of files) {
      let destination = join(target, file.name)
      if (equalPath(await this.canonical(file.path), destination))
        throw new Error('目标文件与源文件相同')
      let suffix = 1
      while ((await this.exists(destination)) || reserved.has(destination.toLowerCase())) {
        const ext = extname(file.name)
        destination = join(target, `${basename(file.name, ext)}_${suffix++}${ext}`)
      }
      reserved.add(destination.toLowerCase())
      const item = { source: file.path, destination, fingerprint: file.fingerprint }
      await this.unchanged(item)
      items.push(item)
    }
    return { target, items }
  }

  async executeMove(plan: MovePlan, signal: AbortSignal): Promise<ToolResult> {
    const moved: { source: string; destination: string }[] = []
    const failed: { source: string; destination: string; error: string; copied: boolean }[] = []
    try {
      signal.throwIfAborted()
      if (!equalPath(await this.canonical(plan.target), plan.target))
        throw new Error('目标目录已变化，请重新确认')
      for (const item of plan.items) {
        try {
          await this.unchanged(item)
          if (await this.exists(item.destination))
            throw new Error(`目标已被占用，请重新确认：${item.destination}`)
          if (!equalPath(await this.canonical(item.source), item.source))
            throw new Error('源文件实际路径已变化')
        } catch (error) {
          failed.push({
            source: item.source,
            destination: item.destination,
            copied: false,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }
      await this.files.makeDirectory(plan.target)
      for (const item of plan.items) {
        if (signal.aborted) break
        let copied = false
        try {
          await this.unchanged(item)
          if (!equalPath(await this.files.realPath(plan.target), plan.target))
            throw new Error('目标目录已变化')
          await this.files.copyExclusive(item.source, item.destination)
          copied = true
          await this.unchanged(item)
          await this.files.removeFile(item.source)
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
        data: { moved, failed, cancelled: plan.items.length - moved.length - failed.length }
      }
    }
  }
}
