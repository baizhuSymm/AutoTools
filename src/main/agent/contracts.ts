import type { ToolDefinition } from '../tools/executor'
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
    signal: AbortSignal
  ): AsyncIterable<ModelEvent>
}
export interface SecretVault {
  encrypt: (key: string) => string | null
  decrypt: (value: string) => string
}

export type HistoryTurns = WireMessage[][]
