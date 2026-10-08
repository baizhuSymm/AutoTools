import type { CrashEvent } from './ipc'

export type ResultStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'rejected'
export interface ToolResult {
  status: ResultStatus
  summary: string
  data?: unknown
}
export interface ToolCall {
  id: string
  scope: string
  name: string
  status: 'validating' | 'awaiting_confirmation' | 'executing' | ResultStatus
  title: string
  details?: unknown
  confirmationId?: string
  result?: ToolResult
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  reasoningStatus?: 'streaming' | 'done' | 'interrupted'
  status?: 'streaming' | 'completed' | 'cancelled' | 'failed'
  calls: ToolCall[]
  createdAt: number
}
export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}
export interface MonitorTask {
  id: string
  deviceId: string
  bundleName: string
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
  startedAt: number
  endedAt?: number
  canStop?: boolean
  reason?: string
  events: CrashEvent[]
  total: number
  truncated: number
}
export interface ModelConfig {
  baseURL: string
  model: string
  hasKey: boolean
  keyPersistent: boolean
  capabilities?: { text: boolean; streaming: boolean; tools: boolean }
}
export interface AppSnapshot {
  sequence: number
  conversations: Conversation[]
  tasks: MonitorTask[]
  calls: ToolCall[]
  activeSessionId: string | null
  config: ModelConfig
  warning?: string
}
export interface AgentAPI {
  snapshot: () => Promise<AppSnapshot>
  createSession: () => Promise<string>
  deleteSession: (id: string) => Promise<void>
  send: (id: string, text: string) => Promise<void>
  cancel: () => Promise<void>
  confirm: (id: string, approved: boolean) => Promise<void>
  execute: (name: string, input: Record<string, unknown>) => Promise<ToolResult>
  saveConfig: (input: { baseURL: string; model: string; key?: string }) => Promise<ModelConfig>
  testConnection: () => Promise<ModelConfig>
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => () => void
}

export const AgentChannels = {
  Snapshot: 'agent:snapshot',
  Event: 'agent:event',
  Create: 'agent:create',
  Delete: 'agent:delete',
  Send: 'agent:send',
  Cancel: 'agent:cancel',
  Confirm: 'agent:confirm',
  Execute: 'agent:execute',
  SaveConfig: 'agent:config',
  Test: 'agent:test'
} as const
