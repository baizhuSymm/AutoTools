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

/** 一次捕获到的崩溃事件 */
export interface CrashEvent {
  /** 自增 id,renderer 用来 key */
  id: number
  /** 事件时间戳(ms) */
  ts: number
  /** 原始 hilog 行(已截单行) */
  raw: string
  /** 关键字命中的严重等级 */
  severity: 'fatal' | 'error' | 'warn' | 'info'
  /** 命中关键字 */
  matchKeyword: string
  /** 解析出的进程/包名(若有) */
  bundleName: string
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
  HdcStreamStart: 'hdc:streamStart',
  HdcStreamStop: 'hdc:streamStop',
  HdcStreamEvent: 'hdc:streamEvent',
  ShellOpenExternal: 'shell:openExternal',
  ChromeDetect: 'chrome:detect',
  ChromeLaunch: 'chrome:launch'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** main -> renderer 推送的流事件 */
export type HdcStreamEventPayload =
  | { type: 'stdout'; streamId: string; data: string }
  | { type: 'stderr'; streamId: string; data: string }
  | { type: 'close'; streamId: string; code: number }
  | { type: 'error'; streamId: string; message: string }