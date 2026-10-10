import type { Conversation, ToolCall } from '../../src/shared/agent'
import type { HistoryTurns } from '../../src/main/contracts/agent'
import type { SessionRepositoryPort, ExecutionRepositoryPort } from '../../src/main/contracts/ports'

export function memoryRepositories() {
  const sessions: Conversation[] = []
  const calls: ToolCall[] = []
  const history: Record<string, HistoryTurns> = {}
  const repository: SessionRepositoryPort = {
    list: () => structuredClone(sessions),
    get: (id) => structuredClone(sessions.find((item) => item.id === id)),
    insert: (value) => {
      sessions.push(structuredClone(value))
    },
    update: (id, change) => {
      const item = sessions.find((item) => item.id === id)
      if (!item) throw new Error('missing session')
      change(item)
    },
    delete: (id) => {
      const index = sessions.findIndex((item) => item.id === id)
      if (index >= 0) sessions.splice(index, 1)
      delete history[id]
    },
    history: (id) => structuredClone(history[id] ?? []),
    setHistory: (id, turns) => {
      history[id] = structuredClone(turns)
    }
  }
  const executions: ExecutionRepositoryPort = {
    calls: () => structuredClone(calls),
    upsert: (call) => {
      const index = calls.findIndex((item) => item.id === call.id)
      if (index < 0) calls.push(structuredClone(call))
      else calls[index] = structuredClone(call)
    },
    deleteCall: (id) => {
      const index = calls.findIndex((item) => item.id === id)
      if (index >= 0) calls.splice(index, 1)
    },
    deleteScope: (scope) => {
      for (let i = calls.length - 1; i >= 0; i--) if (calls[i].scope === scope) calls.splice(i, 1)
    }
  }
  return { repository, executions }
}
