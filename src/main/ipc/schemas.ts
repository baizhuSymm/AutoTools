import { z } from 'zod'

export const id = z.string().uuid()
export const messageText = z.string().min(1).max(65536)
export const approved = z.boolean()
export const toolName = z.string().min(1).max(80)
export const toolInput = z.record(z.string(), z.unknown())
export const modelConfig = z.object({
  baseURL: z.string(),
  model: z.string(),
  key: z.string().optional()
})
