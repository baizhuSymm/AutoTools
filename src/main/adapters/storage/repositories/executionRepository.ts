import type { ToolCall } from '../../../../shared/agent'
import type { AgentDatabase } from '../agentDatabase'

export class ExecutionRepository {
  constructor(private database: AgentDatabase) {}
  calls(): ToolCall[] {
    return this.database.read().calls
  }
  upsert(call: ToolCall): void {
    this.database.update((data) => {
      const index = data.calls.findIndex((item) => item.id === call.id)
      if (index < 0) data.calls.push(structuredClone(call))
      else data.calls[index] = structuredClone(call)
    })
  }
  deleteCall(id: string): void {
    this.database.update((data) => {
      data.calls = data.calls.filter((call) => call.id !== id)
    })
  }
  deleteScope(scope: string): void {
    this.database.update((data) => {
      data.calls = data.calls.filter((call) => call.scope !== scope)
    })
  }
}
