import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DateRange, MoveResult, Video } from '../../shared/ipc'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'])

function parseDateRange(dateRange: DateRange | null | undefined): { startMs: number | null; endMs: number | null } {
  if (!dateRange) return { startMs: null, endMs: null }
  const startMs = dateRange.start ? new Date(`${dateRange.start}T00:00:00`).getTime() : null
  const endMs = dateRange.end ? new Date(`${dateRange.end}T23:59:59.999`).getTime() : null
  return { startMs, endMs }
}

/**
 * 扫描源目录下所有子文件夹中的视频文件
 * @param sourceDir 源目录（如 Steam workshop 路径）
 * @param dateRange 可选日期范围，按子文件夹 mtime 过滤
 */
export function scanVideos(sourceDir: string, dateRange?: DateRange | null): Video[] {
  if (!sourceDir || typeof sourceDir !== 'string') {
    throw new Error('源目录路径不能为空')
  }
  if (!existsSync(sourceDir)) {
    throw new Error(`源目录不存在: ${sourceDir}`)
  }
  const rootStat = statSync(sourceDir)
  if (!rootStat.isDirectory()) {
    throw new Error(`不是目录: ${sourceDir}`)
  }

  const { startMs, endMs } = parseDateRange(dateRange)
  const videos: Video[] = []

  const subfolders = readdirSync(sourceDir, { withFileTypes: true }).filter((d) => d.isDirectory())

  for (const sub of subfolders) {
    const subPath = join(sourceDir, sub.name)
    let folderStat
    try {
      folderStat = statSync(subPath)
    } catch {
      continue
    }

    if (startMs !== null && folderStat.mtimeMs < startMs) continue
    if (endMs !== null && folderStat.mtimeMs > endMs) continue

    let files: string[]
    try {
      files = readdirSync(subPath)
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = join(subPath, file)
      try {
        const fileStat = statSync(filePath)
        if (!fileStat.isFile()) continue
        const ext = extname(file).toLowerCase()
        if (!VIDEO_EXTS.has(ext)) continue
        videos.push({
          path: filePath,
          name: file,
          size: fileStat.size,
          mtime: fileStat.mtimeMs,
          folderMtime: folderStat.mtimeMs,
          fromSubfolder: sub.name
        })
      } catch {
        // skip inaccessible
      }
    }
  }

  return videos
}

/**
 * 将视频文件移动到目标文件夹（跨盘符用复制+删除）
 */
export function moveVideos(videos: Video[], targetDir: string): MoveResult {
  if (!targetDir || typeof targetDir !== 'string') {
    throw new Error('目标目录路径不能为空')
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  const moved: string[] = []
  const failed: MoveResult['failed'] = []

  for (const video of videos) {
    let finalDest = join(targetDir, video.name)
    try {
      if (existsSync(finalDest)) {
        const ts = Date.now()
        const ext = extname(video.name)
        const nameWithoutExt = basename(video.name, ext)
        const newName = `${nameWithoutExt}_${ts}${ext}`
        finalDest = join(targetDir, newName)
      }
      copyFileSync(video.path, finalDest)
      unlinkSync(video.path)
      moved.push(basename(finalDest))
    } catch (e) {
      failed.push({ path: video.path, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { success: failed.length === 0, moved, failed }
}

/**
 * 把文本写入指定文件;父目录会自动创建。
 * 路径为空或非 string 时抛错。
 */
export function writeTextFile(filePath: string, content: string): { path: string; bytes: number } {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('写入路径不能为空')
  }
  const dir = join(filePath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content, { encoding: 'utf8' })
  const size = statSync(filePath).size
  return { path: filePath, bytes: size }
}