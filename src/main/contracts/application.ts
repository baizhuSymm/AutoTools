import type { AppSnapshot, ModelConfig, ToolResult } from '../../shared/agent'

export interface ApplicationServices {
  sessions: { create(): Promise<string> }
  chat: { send(id: string, text: string): Promise<void>; deleteSession(id: string): Promise<void>; cancel(): void }
  tools: { execute(name: string, input: Record<string, unknown>): Promise<ToolResult>; confirm(id: string, approved: boolean): void }
  config: { save(input: { baseURL: string; model: string; key?: string }): Promise<ModelConfig>; testConnection(): Promise<ModelConfig> }
  snapshots: { snapshot(): AppSnapshot }
  workspace: { selectFolder(): Promise<string | null> }
}
