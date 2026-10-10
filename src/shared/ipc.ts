/**
 * 共享类型定义 - main / preload / renderer 共用
 */

export interface Video {
  path: string
  name: string
  size: number
  mtime: number
  folderMtime: number
  fromSubfolder: string
}

export interface DateRange {
  start: string
  end: string
}

export interface MoveFailure {
  path: string
  error: string
}

export interface MoveResult {
  success: boolean
  moved: string[]
  failed: MoveFailure[]
}

export interface HdcExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface WriteFileResult {
  path: string
  bytes: number
}

export const IpcChannels = {
  FileScanVideos: 'file:scanVideos',
  FileMoveVideos: 'file:moveVideos',
  FileWriteText: 'file:writeText',
  DialogSelectFolder: 'dialog:selectFolder',
  HdcExec: 'hdc:exec',
  HdcListBundles: 'hdc:listBundles',
  HdcGetForeground: 'hdc:getForeground',
  ShellOpenExternal: 'shell:openExternal',
  ChromeDetect: 'chrome:detect',
  ChromeLaunch: 'chrome:launch'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
