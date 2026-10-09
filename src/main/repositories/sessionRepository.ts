import type { Conversation } from '../../shared/agent'
import type { HistoryTurns, WireMessage } from '../agent/contracts'
import type { AgentDatabase } from '../storage/agentDatabase'

export class SessionRepository {
  constructor(private database: AgentDatabase) {}
  list(): Conversation[] {
    return this.database.read().conversations
  }
  get(id: string): Conversation | undefined {
    return this.list().find((session) => session.id === id)
  }
  insert(session: Conversation): void {
    this.database.update((data) => data.conversations.unshift(structuredClone(session)))
  }
  update(id: string, change: (session: Conversation) => void): void {
    this.database.update((data) => {
      const session = data.conversations.find((item) => item.id === id)
      if (!session) throw new Error('会话不存在')
      change(session)
    })
  }
  delete(id: string): void {
    this.database.update((data) => {
      data.conversations = data.conversations.filter((session) => session.id !== id)
      delete data.history[id]
    })
  }
  history(id: string): HistoryTurns {
    return this.database.read().history[id] ?? []
  }
  appendTurn(id: string, turn: WireMessage[]): void {
    this.database.update((data) => {
      data.history[id] = [...(data.history[id] ?? []), structuredClone(turn)].slice(-20)
    })
  }
}
