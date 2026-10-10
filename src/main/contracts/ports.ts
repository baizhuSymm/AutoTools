import type { Conversation, ToolCall } from '../../shared/agent'
import type { HistoryTurns, StoredConfig } from './agent'
import type { HdcExecResult } from '../../shared/ipc'

export interface SessionRepositoryPort {
  list(): Conversation[]
  get(id: string): Conversation | undefined
  insert(session: Conversation): void
  update(id: string, change: (session: Conversation) => void): void
  delete(id: string): void
  history(id: string): HistoryTurns
  setHistory(id: string, turns: HistoryTurns): void
}
export interface ExecutionRepositoryPort {
  calls(): ToolCall[]
  upsert(call: ToolCall): void
  deleteCall(id: string): void
  deleteScope(scope: string): void
}
export interface ConfigRepositoryPort {
  readConfig(): { config: StoredConfig; encryptedKey?: string }
  saveConfig(config: StoredConfig, encryptedKey?: string): void
}
export interface PersistencePort {
  schedule(): void
  commit(): Promise<void>
}
export interface FolderDialogPort {
  selectFolder(): Promise<string | null>
}
export interface ChromePort {
  open(url: string): Promise<void>
}
export interface ExternalLinkPort {
  open(url: string): Promise<void>
}
export type FileKind = 'file' | 'directory' | 'symlink' | 'other'
export interface FileInfo {
  kind: FileKind
  size: number
  mtimeMs: number
  dev: number
  ino: number
}
export interface FileSystemPort {
  readDirectory(path: string): Promise<{ name: string; kind: FileKind }[]>
  info(path: string, followLinks: boolean): Promise<FileInfo>
  realPath(path: string): Promise<string>
  makeDirectory(path: string): Promise<void>
  copyExclusive(source: string, destination: string): Promise<void>
  removeFile(path: string): Promise<void>
}
export interface HdcPort {
  listTargets(signal: AbortSignal): Promise<HdcExecResult>
  queryBundles(
    deviceId: string,
    variant: 'bm' | 'pm' | 'bm-user',
    signal: AbortSignal
  ): Promise<HdcExecResult>
  queryForeground(
    deviceId: string,
    variant: 'aa' | 'window',
    signal: AbortSignal
  ): Promise<HdcExecResult>
  queryProcesses(deviceId: string, signal: AbortSignal): Promise<HdcExecResult>
  querySockets(deviceId: string, signal: AbortSignal): Promise<HdcExecResult>
  listForwards(deviceId: string, signal: AbortSignal): Promise<HdcExecResult>
  enableDebugging(deviceId: string, signal: AbortSignal): Promise<HdcExecResult>
  createForward(
    deviceId: string,
    port: number,
    socketName: string,
    signal: AbortSignal
  ): Promise<HdcExecResult>
  removeForward(deviceId: string, port: number, signal: AbortSignal): Promise<HdcExecResult>
}
