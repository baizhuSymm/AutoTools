import { randomUUID } from 'node:crypto'
import type { ToolDefinition } from '../../contracts/agent'
import type { ToolCall, ToolResult } from '../../../shared/agent'

export interface ExecutionContext {
  scope: string
  signal: AbortSignal
  update: (call: ToolCall) => void
}

export class ToolExecutor {
  readonly definitions: ToolDefinition[]
  private pending = new Map<string, (approved: boolean) => void>()
  private tail: Promise<void> = Promise.resolve()

  constructor(definitions: ToolDefinition[]) {
    this.definitions = definitions
  }

  confirm(id: string, approved: boolean): void {
    const resolve = this.pending.get(id)
    if (!resolve) throw new Error('确认已失效或已使用')
    this.pending.delete(id)
    resolve(approved)
  }

  async execute(name: string, input: unknown, context: ExecutionContext): Promise<ToolResult> {
    const call: ToolCall = {
      id: randomUUID(),
      scope: context.scope,
      name,
      status: 'validating',
      title: name
    }
    const update = (): void => context.update(structuredClone(call))
    const finish = (result: ToolResult): ToolResult => {
      call.status = result.status
      call.result = result
      delete call.confirmationId
      update()
      return result
    }
    update()
    try {
      context.signal.throwIfAborted()
      const definition = this.definitions.find((tool) => tool.name === name)
      if (!definition) throw new Error('未知工具')
      const parsed = definition.schema.parse(input)
      let release: () => void = () => {}
      try {
        context.signal.throwIfAborted()
        const prepared = await definition.prepare(parsed)
        const data = structuredClone(prepared.data)
        call.title = prepared.title
        call.details = structuredClone(prepared.details)
        context.signal.throwIfAborted()
        if (definition.confirm) {
          const id = randomUUID()
          call.confirmationId = id
          call.status = 'awaiting_confirmation'
          const approved = await new Promise<boolean>((resolve) => {
            const abort = (): void => {
              this.pending.delete(id)
              resolve(false)
            }
            this.pending.set(id, (value) => {
              context.signal.removeEventListener('abort', abort)
              resolve(value)
            })
            context.signal.addEventListener('abort', abort, { once: true })
            update()
          })
          delete call.confirmationId
          context.signal.throwIfAborted()
          if (!approved) return finish({ status: 'rejected', summary: '用户拒绝了本次操作' })
          // Only approved mutations hold the execution lock; queries and task stop stay available.
          const prior = this.tail
          this.tail = new Promise<void>((resolve) => {
            release = resolve
          })
          await prior
        }
        context.signal.throwIfAborted()
        call.status = 'executing'
        update()
        return finish(await definition.execute(data, context.signal))
      } finally {
        release()
      }
    } catch (error) {
      return finish({
        status: context.signal.aborted ? 'cancelled' : 'failed',
        summary: context.signal.aborted
          ? '操作已取消'
          : error instanceof Error
            ? error.message
            : String(error)
      })
    }
  }
}
