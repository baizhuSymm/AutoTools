import type { ModelConfig, ToolCall } from '../../shared/agent'
import type { ModelAdapter } from '../agent/contracts'
import type { AgentRunner, RunnerEvent } from '../agent/runner'
import type { SessionService } from './sessionService'
import type { ModelConfigService } from './modelConfigService'
import type { ToolService } from './toolService'
import type { PersistenceCoordinator } from '../storage/persistenceCoordinator'

export class ChatService {
  private controller?: AbortController
  private running?: Promise<void>
  private active: string | null = null
  private closing = false
  constructor(
    private sessions: SessionService,
    private config: ModelConfigService,
    private tools: ToolService,
    private runner: AgentRunner,
    private modelFactory: (config: ModelConfig, key: string) => ModelAdapter,
    private persistence: PersistenceCoordinator,
    private changed: () => void
  ) {}
  activeSessionId(): string | null {
    return this.active
  }
  send(id: string, text: string): Promise<void> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.controller) throw new Error('已有对话正在执行')
    const credentials = this.config.credentials()
    const model = this.modelFactory(credentials.config, credentials.key)
    const { messageId, messages } = this.sessions.beginTurn(id, text)
    this.controller = new AbortController()
    this.active = id
    this.changed()
    this.running = this.run(
      id,
      messageId,
      messages,
      model,
      this.controller.signal,
      Boolean(credentials.config.capabilities?.tools)
    )
    return this.running
  }
  cancel(): void {
    this.controller?.abort()
    this.changed()
  }
  async deleteSession(id: string): Promise<void> {
    if (this.active === id) {
      this.cancel()
      await this.running
    }
    await this.sessions.delete(id)
  }
  private updateCall(id: string, messageId: string, call: ToolCall): void {
    this.sessions.updateMessage(id, messageId, (message) => {
      const index = message.calls.findIndex((item) => item.id === call.id)
      if (index < 0) message.calls.push(call)
      else message.calls[index] = call
    })
  }
  private apply(id: string, messageId: string, event: RunnerEvent): void {
    if (event.type === 'finished') this.sessions.appendHistory(id, event.turn)
    this.sessions.updateMessage(id, messageId, (message) => {
      if (event.type === 'text') message.content += event.text
      else if (event.type === 'reasoning')
        message.reasoning = (message.reasoning ?? '') + event.text
      else if (event.type === 'reasoning-status') message.reasoningStatus = event.status
      else if (event.type === 'finished') {
        message.status = event.status
        if (event.status === 'cancelled')
          message.content += '\n已停止生成。已完成操作和运行中的监控仍保留。'
        else if (event.status === 'failed')
          message.content += `\n${this.config.sanitize(event.error)}`
      }
    })
  }
  private async run(
    id: string,
    messageId: string,
    messages: Parameters<AgentRunner['run']>[0]['messages'],
    model: ModelAdapter,
    signal: AbortSignal,
    supportsTools: boolean
  ): Promise<void> {
    try {
      await this.persistence.commit()
      for await (const event of this.runner.run({
        messages,
        model,
        signal,
        definitions: supportsTools ? this.tools.definitions() : [],
        execute: (name, args) =>
          this.tools.executeForTurn(name, args, {
            sessionId: id,
            signal,
            onCall: (call) => this.updateCall(id, messageId, call)
          })
      }))
        this.apply(id, messageId, event)
      await this.persistence.commit()
    } catch (error) {
      this.sessions.updateMessage(id, messageId, (message) => {
        message.status = signal.aborted ? 'cancelled' : 'failed'
        if (message.reasoningStatus === 'streaming') message.reasoningStatus = 'interrupted'
        message.content += `\n${this.config.sanitize(error)}`
      })
      throw error
    } finally {
      this.controller = undefined
      this.active = null
      this.changed()
    }
  }
  async close(): Promise<void> {
    this.closing = true
    this.cancel()
    await this.running
  }
}
