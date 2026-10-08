import { createContext, useContext } from 'react'
import type { AppSnapshot } from '../../../../shared/agent'

export interface AgentContextValue {
  snapshot: AppSnapshot
  selectedId: string | null
  select: (id: string) => void
  report: (error: unknown) => void
}
export const AgentContext = createContext<AgentContextValue | null>(null)
export function useAgent(): AgentContextValue {
  const context = useContext(AgentContext)
  if (!context) throw new Error('Agent context missing')
  return context
}
