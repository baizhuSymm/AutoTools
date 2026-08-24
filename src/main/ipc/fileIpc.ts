import { dialog, ipcMain } from 'electron'
import {
  IpcChannels,
  type DateRange,
  type MoveResult,
  type Video,
  type WriteFileResult
} from '../../shared/ipc'
import { moveVideos, scanVideos, writeTextFile } from '../services/fileService'

export function registerFileIpc(): void {
  ipcMain.handle(IpcChannels.FileScanVideos, async (_event, sourceDir: string, dateRange: DateRange | null): Promise<Video[]> => {
    return scanVideos(sourceDir, dateRange)
  })

  ipcMain.handle(IpcChannels.FileMoveVideos, async (_event, videos: Video[], targetDir: string): Promise<MoveResult> => {
    return moveVideos(videos, targetDir)
  })

  ipcMain.handle(
    IpcChannels.FileWriteText,
    async (_event, filePath: string, content: string): Promise<WriteFileResult> => {
      return writeTextFile(filePath, content)
    }
  )

  ipcMain.handle(IpcChannels.DialogSelectFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}