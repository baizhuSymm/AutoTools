import type { z } from 'zod'
import type { Conversation, ModelConfig, ToolCall, ToolResult } from '../../shared/agent'
export interface ModelCall {
  id: string
  name: string
  args: Record<string, unknown>
}
export interface WireMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoning?: string
  tool_calls?: ModelCall[]
  tool_call_id?: string
}
export type ModelEvent =
  { type: 'text' | 'reasoning'; text: string } | { type: 'calls'; calls: ModelCall[] }
export interface ModelAdapter {
  stream(
    messages: WireMessage[],
    definitions: ToolDefinition[],
    signal: AbortSignal,
    systemPrompt: string
  ): AsyncIterable<ModelEvent>
}
export interface SecretVault {
  encrypt: (key: string) => string | null
  decrypt: (value: string) => string
}

export type HistoryTurns = WireMessage[][]

export interface PreparedTool {
  title: string
  details: unknown
  data: unknown
}
export interface ToolDefinition {
  name: string
  description: string
  schema: z.ZodType<Record<string, unknown>>
  confirm: boolean
  prepare: (input: Record<string, unknown>) => Promise<PreparedTool>
  execute: (data: unknown, signal: AbortSignal) => Promise<ToolResult>
}

export type ModelFactory = (config: ModelConfig, key: string) => ModelAdapter
export type ModelProbe = (
  config: ModelConfig,
  key: string
) => Promise<NonNullable<ModelConfig['capabilities']>>
export type StoredConfig = Omit<ModelConfig, 'hasKey' | 'keyPersistent'>
export interface AgentRecords {
  conversations: Conversation[]
  history: Record<string, HistoryTurns>
  calls: ToolCall[]
}
