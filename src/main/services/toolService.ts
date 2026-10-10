import type { ToolCall, ToolResult } from '../../shared/agent'
import type { ToolExecutor } from '../tools/executor'
import type { ToolDefinition } from '../contracts/agent'
import type { ExecutionRepository } from '../repositories/executionRepository'
import type { PersistenceCoordinator } from '../storage/persistenceCoordinator'

export interface TurnExecutionContext {
  sessionId: string
  signal: AbortSignal
  onCall: (call: ToolCall) => void
}

export class ToolService {
  private closing = false
  private manual = new Map<AbortController, Promise<ToolResult>>()
  constructor(
    private executor: ToolExecutor,
    private repository: ExecutionRepository,
    private persistence: PersistenceCoordinator,
    private changed: () => void
  ) {}
  definitions(): ToolDefinition[] {
    return this.executor.definitions
  }
  calls(): ToolCall[] {
    return this.repository.calls()
  }
  confirm(id: string, approved: boolean): void {
    this.executor.confirm(id, approved)
  }
  private update(call: ToolCall): void {
    this.repository.upsert(call)
    this.persistence.schedule()
    this.changed()
  }
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (this.closing) throw new Error('应用正在退出')
    const controller = new AbortController()
    const operation = this.runManual(name, input, controller.signal).finally(() => {
      this.manual.delete(controller)
    })
    this.manual.set(controller, operation)
    return operation
  }
  private async runManual(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ToolResult> {
    // 存储不可用时，不能先执行有副作用的工具再报告保存失败。
    await this.persistence.commit()
    if (signal.aborted) return { status: 'cancelled', summary: '操作已取消' }
    try {
      return await this.executor.execute(name, input, {
        scope: 'manual',
        signal,
        update: (call) => this.update(call)
      })
    } finally {
      await this.persistence.commit()
    }
  }
  executeForTurn(
    name: string,
    input: Record<string, unknown>,
    context: TurnExecutionContext
  ): Promise<ToolResult> {
    if (this.closing) return Promise.reject(new Error('应用正在退出'))
    return this.executor.execute(name, input, {
      scope: context.sessionId,
      signal: context.signal,
      update: (call) => {
        this.update(call)
        context.onCall(call)
      }
    })
  }
  async close(): Promise<void> {
    this.closing = true
    const operations = [...this.manual.values()]
    for (const controller of this.manual.keys()) controller.abort()
    const results = await Promise.allSettled(operations)
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        '手动工具退出清理失败'
      )
  }
}
