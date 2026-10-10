import { z } from 'zod'
import type { Conversation, ModelConfig, ToolCall } from '../../shared/agent'
import type { HistoryTurns } from '../agent/contracts'

export type StoredConfig = Omit<ModelConfig, 'hasKey' | 'keyPersistent'>
export interface AgentData {
  version: 1
  conversations: Conversation[]
  history: Record<string, HistoryTurns>
  calls: ToolCall[]
}
export interface MigrationRecord {
  kind: 'fresh' | 'legacy'
  sourceHash?: string
  backupPath?: string
}
export interface SettingsData {
  version: 1
  config: StoredConfig
  encryptedKey?: string
  migration?: MigrationRecord
}
export interface LegacyState extends AgentData {
  config: StoredConfig
  encryptedKey?: string
}

const result = z.object({
  status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'rejected']),
  summary: z.string(),
  data: z.unknown().optional()
})
const call = z.object({
  id: z.string(),
  scope: z.string(),
  name: z.string(),
  title: z.string(),
  status: z.enum([
    'validating',
    'awaiting_confirmation',
    'executing',
    'succeeded',
    'partial',
    'failed',
    'cancelled',
    'rejected'
  ]),
  details: z.unknown().optional(),
  confirmationId: z.string().optional(),
  result: result.optional()
})
const message = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string().optional(),
  reasoningStatus: z.enum(['streaming', 'done', 'interrupted']).optional(),
  status: z.enum(['streaming', 'completed', 'cancelled', 'failed']).optional(),
  calls: z.array(call),
  createdAt: z.number()
})
const modelCall = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown())
})
const wireMessage = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  reasoning: z.string().optional(),
  tool_calls: z.array(modelCall).optional(),
  tool_call_id: z.string().optional()
})
const state = z.object({
  version: z.literal(1),
  conversations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      messages: z.array(message),
      updatedAt: z.number()
    })
  ),
  history: z.record(z.string(), z.array(z.array(wireMessage))),
  calls: z.array(call).default([]),
  config: z.object({
    baseURL: z.string(),
    model: z.string(),
    capabilities: z
      .object({ text: z.boolean(), streaming: z.boolean(), tools: z.boolean() })
      .optional()
  }),
  encryptedKey: z.string().optional()
})

export function parseLegacy(input: unknown): LegacyState {
  return state.parse(input)
}

export function parseAgentData(input: unknown): AgentData {
  return state.omit({ config: true, encryptedKey: true }).parse(input)
}
export function parseSettings(input: unknown): SettingsData {
  return state
    .pick({ version: true, config: true, encryptedKey: true })
    .extend({
      migration: z
        .object({
          kind: z.enum(['fresh', 'legacy']),
          sourceHash: z.string().optional(),
          backupPath: z.string().optional()
        })
        .optional()
    })
    .parse(input)
}
