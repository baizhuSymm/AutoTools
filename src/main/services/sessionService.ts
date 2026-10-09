import { randomUUID } from 'node:crypto'
import type { ChatMessage, Conversation } from '../../shared/agent'
import type { WireMessage } from '../agent/contracts'
import { boundedHistory } from '../agent/history'
import type { SessionRepository } from '../repositories/sessionRepository'
import type { ExecutionRepository } from '../repositories/executionRepository'
import type { PersistenceCoordinator } from '../storage/persistenceCoordinator'

export class SessionService {
  constructor(private repository: SessionRepository, private executions: ExecutionRepository, private persistence: PersistenceCoordinator, private changed: () => void) {}
  list(): Conversation[] { return this.repository.list() }
  get(id: string): Conversation | undefined { return this.repository.get(id) }
  async create(): Promise<string> {
    const id = randomUUID()
    this.repository.insert({ id, title: '新会话', messages: [], updatedAt: Date.now() })
    await this.persistence.commit()
    this.changed()
    return id
  }
  async delete(id: string): Promise<void> {
    this.repository.delete(id)
    this.executions.deleteScope(id)
    await this.persistence.commit()
    this.changed()
  }
  beginTurn(id: string, text: string): { messageId: string; messages: WireMessage[] } {
    if (!text.trim()) throw new Error('消息不能为空')
    const messages = boundedHistory(this.repository.history(id), text)
    const messageId = randomUUID()
    const now = Date.now()
    this.repository.update(id, (session) => {
      session.messages.push(
        { id: randomUUID(), role: 'user', content: text, calls: [], createdAt: now },
        { id: messageId, role: 'assistant', content: '', status: 'streaming', calls: [], createdAt: now }
      )
      if (session.title === '新会话') session.title = text.trim().slice(0, 32)
      session.updatedAt = now
    })
    this.changed()
    return { messageId, messages }
  }
  updateMessage(id: string, messageId: string, change: (message: ChatMessage) => void): void {
    this.repository.update(id, (session) => { const message = session.messages.find((item) => item.id === messageId); if (!message) throw new Error('消息不存在'); change(message) })
    this.persistence.schedule()
    this.changed()
  }
  appendHistory(id: string, turn: WireMessage[]): void { this.repository.appendTurn(id, turn) }
}
