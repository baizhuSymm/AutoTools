import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  AppSnapshot,
  Conversation,
  ModelConfig,
  MonitorTask,
  ToolCall,
  ToolResult
} from '../../shared/agent'
import type { ToolExecutor, ToolDefinition } from '../tools/executor'
import type { JsonStore } from '../storage/store'
import { parsePersisted } from '../storage/schema'
import { ReasoningSplitter, type ReasoningPart } from '../../shared/reasoning'

import type { ModelAdapter, ModelCall, WireMessage, SecretVault } from './contracts'
export type { ModelAdapter, ModelEvent, ModelCall, WireMessage } from './contracts'
export type { LegacyState as PersistedState } from '../storage/schema'
import type { LegacyState as PersistedState } from '../storage/schema'
import { boundedHistory } from './history'
export { boundedHistory } from './history'
import { summarizeResult } from './toolSummary'
export { summarizeResult } from './toolSummary'
export class AgentRuntime {
  private conversations: Conversation[] = []
  private history: Record<string, WireMessage[][]> = {}
  private calls: ToolCall[] = []
  private config: ModelConfig = { baseURL: '', model: '', hasKey: false, keyPersistent: false }
  private key = ''
  private encryptedKey?: string
  private controller?: AbortController
  private currentRun?: Promise<void>
  private activeSessionId: string | null = null
  private manual = new Map<AbortController, Promise<ToolResult>>()
  private closing = false
  private configRevision = 0
  private sequence = 0
  private timer?: ReturnType<typeof setTimeout>
  private persistenceTimer?: ReturnType<typeof setTimeout>
  private restoredTasks: MonitorTask[] = []
  tasks: () => MonitorTask[] = () => []
  warning?: string

  constructor(
    private store: JsonStore,
    readonly executor: ToolExecutor,
    private modelFactory: (config: ModelConfig, key: string) => ModelAdapter,
    private vault: SecretVault,
    private publish: (snapshot: AppSnapshot) => void
  ) {}

  async init(): Promise<void> {
    const state = await this.store.load<PersistedState>(
      {
        version: 1,
        conversations: [],
        history: {},
        calls: [],
        tasks: [],
        config: { baseURL: '', model: '' }
      },
      parsePersisted
    )
    if (
      state.version !== 1 ||
      !Array.isArray(state.conversations) ||
      !state.history ||
      !state.config
    ) {
      this.warning = '本地记录版本或结构无效，未加载'
      return
    }
    this.conversations = state.conversations
    for (const message of this.conversations.flatMap((session) => session.messages)) {
      if (message.status === 'streaming') message.status = 'cancelled'
      if (message.reasoningStatus === 'streaming') message.reasoningStatus = 'interrupted'
    }
    this.history = state.history
    this.calls = state.calls ?? []
    this.restoredTasks = (state.tasks ?? []).map((task) => ({
      ...task,
      events: [],
      canStop: false,
      status: ['running', 'starting', 'stopping'].includes(task.status) ? 'failed' : task.status,
      reason: ['running', 'starting', 'stopping'].includes(task.status)
        ? '应用已退出，任务已中断'
        : task.reason
    }))
    for (const call of [
      ...this.calls,
      ...this.conversations.flatMap((session) =>
        session.messages.flatMap((message) => message.calls)
      )
    ]) {
      delete call.confirmationId
      if (['validating', 'executing', 'awaiting_confirmation'].includes(call.status)) {
        call.status = 'cancelled'
        call.result = { status: 'cancelled', summary: '上次运行已中断，未恢复执行' }
      }
    }
    this.encryptedKey = state.encryptedKey
    try {
      this.key = this.encryptedKey ? this.vault.decrypt(this.encryptedKey) : ''
    } catch {
      this.warning = '保存的密钥无法解密，请重新填写'
    }
    this.config = {
      ...state.config,
      hasKey: Boolean(this.key),
      keyPersistent: Boolean(this.encryptedKey && this.key)
    }
    this.warning ??= this.store.warning
  }

  snapshot(): AppSnapshot {
    return structuredClone({
      sequence: this.sequence,
      conversations: this.conversations,
      tasks: [...this.restoredTasks, ...this.tasks()],
      calls: this.calls,
      activeSessionId: this.activeSessionId,
      config: this.config,
      warning: this.warning
    })
  }
  changed(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.sequence++
      this.publish(this.snapshot())
    }, 80)
    this.timer.unref?.()
  }
  private persist(): Promise<void> {
    const { hasKey: _hasKey, keyPersistent: _persistent, ...config } = this.config
    return this.store.save({
      version: 1,
      conversations: this.conversations,
      history: this.history,
      calls: this.calls,
      config,
      encryptedKey: this.encryptedKey,
      tasks: [...this.restoredTasks, ...this.tasks()].map((task) => ({ ...task, events: [] }))
    })
  }
  private schedulePersist(): void {
    if (this.persistenceTimer) return
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined
      void this.persist().catch((error: unknown) => {
        this.warning = String(error)
        this.changed()
      })
    }, 1000)
    this.persistenceTimer.unref?.()
  }

  async createSession(): Promise<string> {
    const id = randomUUID()
    this.conversations.unshift({ id, title: '新会话', messages: [], updatedAt: Date.now() })
    await this.persist()
    this.changed()
    return id
  }
  async deleteSession(id: string): Promise<void> {
    if (this.activeSessionId === id) {
      this.cancel()
      await this.currentRun
    }
    this.conversations = this.conversations.filter((session) => session.id !== id)
    this.calls = this.calls.filter((call) => call.scope !== id)
    delete this.history[id]
    await this.persist()
    this.changed()
  }
  async saveConfig(input: { baseURL: string; model: string; key?: string }): Promise<ModelConfig> {
    if (this.controller) throw new Error('请先停止当前对话再修改模型设置')
    const parsed = z
      .object({ baseURL: z.url(), model: z.string().trim().min(1), key: z.string().optional() })
      .parse(input)
    const url = new URL(parsed.baseURL)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('API 地址无效')
    if (parsed.key !== undefined) this.key = parsed.key.trim()
    this.encryptedKey = this.key ? (this.vault.encrypt(this.key) ?? undefined) : undefined
    this.config = {
      baseURL: parsed.baseURL.replace(/\/+$/, ''),
      model: parsed.model,
      hasKey: Boolean(this.key),
      keyPersistent: Boolean(this.encryptedKey)
    }
    this.configRevision++
    await this.persist()
    this.changed()
    return structuredClone(this.config)
  }
  setCapabilities(capabilities: NonNullable<ModelConfig['capabilities']>): void {
    this.config.capabilities = capabilities
    this.changed()
    this.schedulePersist()
  }
  model(): ModelAdapter {
    if (!this.key || !this.config.model || !this.config.baseURL)
      throw new Error('请先配置 API 地址、Key 和模型名称')
    return this.modelFactory(this.config, this.key)
  }
  async testConnection(
    probe: (config: ModelConfig, key: string) => Promise<NonNullable<ModelConfig['capabilities']>>
  ): Promise<ModelConfig> {
    this.model()
    if (this.controller) throw new Error('请先停止当前对话再测试连接')
    const revision = this.configRevision
    const capabilities = await probe(structuredClone(this.config), this.key)
    if (revision !== this.configRevision) throw new Error('模型配置已变化，请重新测试当前配置')
    this.setCapabilities(capabilities)
    await this.persist()
    return structuredClone(this.config)
  }
  private sanitize(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error)
    if (this.key) message = message.split(this.key).join('[REDACTED]')
    return message.slice(0, 2000)
  }
  private updateCall(call: ToolCall, sessionId?: string): void {
    const index = this.calls.findIndex((item) => item.id === call.id)
    if (index === -1) this.calls.push(call)
    else this.calls[index] = call
    if (this.calls.length > 200) {
      const disposable = this.calls.findIndex(
        (item) => !['awaiting_confirmation', 'executing', 'validating'].includes(item.status)
      )
      if (disposable !== -1) this.calls.splice(disposable, 1)
    }
    if (sessionId) {
      const message = this.conversations
        .find((session) => session.id === sessionId)
        ?.messages.at(-1)
      if (message?.role === 'assistant') {
        const existing = message.calls.findIndex((item) => item.id === call.id)
        if (existing === -1) message.calls.push(call)
        else message.calls[existing] = call
      }
    }
    this.changed()
    this.schedulePersist()
  }
  confirm(id: string, approved: boolean): void {
    this.executor.confirm(id, approved)
  }
  cancel(): void {
    this.controller?.abort()
    this.changed()
  }
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (this.closing) throw new Error('应用正在退出')
    const controller = new AbortController()
    const operation = this.executor
      .execute(name, input, {
        scope: 'manual',
        signal: controller.signal,
        update: (call) => this.updateCall(call)
      })
      .finally(async () => {
        this.manual.delete(controller)
        await this.persist()
      })
    this.manual.set(controller, operation)
    return operation
  }

  send(id: string, text: string): Promise<void> {
    if (this.closing) throw new Error('应用正在退出')
    if (this.controller) throw new Error('已有对话正在执行')
    if (!text.trim()) throw new Error('消息不能为空')
    const session = this.conversations.find((item) => item.id === id)
    if (!session) throw new Error('会话不存在')
    const model = this.model()
    const messages = boundedHistory(this.history[id] ?? [], text)
    this.controller = new AbortController()
    this.activeSessionId = id
    const signal = this.controller.signal
    const now = Date.now()
    session.messages.push(
      { id: randomUUID(), role: 'user', content: text, calls: [], createdAt: now },
      {
        id: randomUUID(),
        role: 'assistant',
        content: '',
        status: 'streaming',
        calls: [],
        createdAt: now
      }
    )
    if (session.title === '新会话') session.title = text.trim().slice(0, 32)
    session.updatedAt = now
    this.changed()
    this.currentRun = this.run(session, messages, model, signal)
    return this.currentRun
  }

  private async run(
    session: Conversation,
    messages: WireMessage[],
    model: ModelAdapter,
    signal: AbortSignal
  ): Promise<void> {
    const output = session.messages.at(-1)!
    const turn: WireMessage[] = [{ role: 'user', content: session.messages.at(-2)!.content }]
    let count = 0
    let responseBytes = 0
    let splitter = new ReasoningSplitter()
    const append = (part: ReasoningPart): void => {
      if (part.type === 'reasoning') {
        output.reasoning = (output.reasoning ?? '') + part.text
        output.reasoningStatus = 'streaming'
      } else {
        output.content += part.text
        if (output.reasoningStatus === 'streaming' && !splitter.open)
          output.reasoningStatus = 'done'
      }
    }
    try {
      await this.persist()
      for (;;) {
        signal.throwIfAborted()
        if (Buffer.byteLength(JSON.stringify(messages)) > 62000)
          throw new Error('本回合结果过多，请开始新的请求')
        let calls: ModelCall[] = []
        let text = ''
        let reasoning = ''
        splitter = new ReasoningSplitter()
        const definitions = this.config.capabilities?.tools ? this.executor.definitions : []
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)])
        for await (const event of model.stream(messages, definitions, requestSignal)) {
          signal.throwIfAborted()
          if (event.type !== 'calls') {
            responseBytes += Buffer.byteLength(event.text)
            if (responseBytes > 131072) throw new Error('模型回复超过长度上限')
            if (event.type === 'reasoning') {
              reasoning += event.text
              append(event)
            } else {
              text += event.text
              for (const part of splitter.feed(event.text)) append(part)
              if (splitter.seen && splitter.open) output.reasoningStatus = 'streaming'
              else if (splitter.seen) output.reasoningStatus = 'done'
            }
            this.changed()
            this.schedulePersist()
          } else calls = event.calls
        }
        requestSignal.throwIfAborted()
        for (const part of splitter.feed('', true)) append(part)
        if (splitter.open) output.reasoningStatus = 'interrupted'
        else if (output.reasoningStatus === 'streaming') output.reasoningStatus = 'done'
        if (!calls.length) {
          turn.push({ role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}) })
          break
        }
        if (!definitions.length) throw new Error('此模型尚未通过工具调用测试，请在设置中测试连接')
        if (count + calls.length > 12) throw new Error('达到每回合 12 次工具调用上限，请拆分请求')
        if (
          new Set(calls.map((call) => call.id)).size !== calls.length ||
          calls.some((call) => !call.id)
        )
          throw new Error('模型工具调用 ID 无效')
        const assistant: WireMessage = {
          role: 'assistant',
          content: text,
          tool_calls: calls,
          ...(reasoning ? { reasoning } : {})
        }
        messages.push(assistant)
        turn.push(assistant)
        let rejected = false
        for (const call of calls) {
          const result: ToolResult = rejected
            ? { status: 'cancelled', summary: '前序操作被拒绝，未执行后续调用' }
            : await this.executor.execute(call.name, call.args, {
                scope: session.id,
                signal,
                update: (value) => this.updateCall(value, session.id)
              })
          count++
          const summary = summarizeResult(result)
          const toolMessage: WireMessage = { role: 'tool', content: summary, tool_call_id: call.id }
          messages.push(toolMessage)
          turn.push(toolMessage)
          if (result.status === 'rejected' || result.status === 'cancelled') rejected = true
        }
        if (rejected) {
          output.content += '\n操作已拒绝或取消，未继续执行。'
          break
        }
        if (count >= 12) {
          output.content += '\n已达到本回合工具调用上限。'
          break
        }
        if (text) output.content += '\n'
      }
      output.status = 'completed'
    } catch (error) {
      for (const part of splitter.feed('', true)) append(part)
      if (output.reasoningStatus === 'streaming' || splitter.open)
        output.reasoningStatus = 'interrupted'
      output.status = signal.aborted ? 'cancelled' : 'failed'
      output.content += signal.aborted
        ? '\n已停止生成。已完成操作和运行中的监控仍保留。'
        : `\n${this.sanitize(error)}`
    } finally {
      this.history[session.id] = [...(this.history[session.id] ?? []), turn].slice(-20)
      this.controller = undefined
      this.activeSessionId = null
      if (this.persistenceTimer) clearTimeout(this.persistenceTimer)
      this.persistenceTimer = undefined
      await this.persist().catch((error: unknown) => {
        this.warning = this.sanitize(error)
      })
      this.changed()
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true
    this.cancel()
    const operations = [...this.manual.values()]
    for (const controller of this.manual.keys()) controller.abort()
    await Promise.allSettled([this.currentRun, ...operations])
    if (this.timer) clearTimeout(this.timer)
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer)
    await this.persist()
    await this.store.flush()
  }
  async flush(): Promise<void> {
    await this.persist()
    await this.store.flush()
  }
}

