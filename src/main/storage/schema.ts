import { z } from 'zod'
import type { PersistedState } from '../agent/runtime'

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
const task = z.object({
  id: z.string(),
  deviceId: z.string(),
  bundleName: z.string(),
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'failed']),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  canStop: z.boolean().optional(),
  reason: z.string().optional(),
  events: z.array(
    z.object({
      id: z.number(),
      ts: z.number(),
      raw: z.string(),
      severity: z.enum(['fatal', 'error', 'warn', 'info']),
      matchKeyword: z.string(),
      bundleName: z.string()
    })
  ),
  total: z.number(),
  truncated: z.number()
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
  tasks: z.array(task).default([]),
  config: z.object({
    baseURL: z.string(),
    model: z.string(),
    capabilities: z
      .object({ text: z.boolean(), streaming: z.boolean(), tools: z.boolean() })
      .optional()
  }),
  encryptedKey: z.string().optional()
})

export function parsePersisted(input: unknown): PersistedState {
  return state.parse(input)
}
