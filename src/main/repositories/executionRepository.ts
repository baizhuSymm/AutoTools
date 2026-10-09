import type { ToolCall, MonitorTask } from '../../shared/agent'
import type { AgentDatabase } from '../storage/agentDatabase'

export class ExecutionRepository {
  constructor(private database: AgentDatabase) {}
  calls(): ToolCall[] { return this.database.read().calls }
  upsert(call: ToolCall): void {
    this.database.update((data) => {
      const index = data.calls.findIndex((item) => item.id === call.id)
      if (index < 0) data.calls.push(structuredClone(call))
      else data.calls[index] = structuredClone(call)
      if (data.calls.length > 200) {
        const disposable = data.calls.findIndex((item) => !['awaiting_confirmation', 'executing', 'validating'].includes(item.status))
        if (disposable >= 0) data.calls.splice(disposable, 1)
      }
    })
  }
  deleteScope(scope: string): void { this.database.update((data) => { data.calls = data.calls.filter((call) => call.scope !== scope) }) }
  tasks(): MonitorTask[] { return this.database.read().tasks }
  replaceTasks(tasks: MonitorTask[]): void { this.database.update((data) => { data.tasks = tasks.map((task) => ({ ...structuredClone(task), events: [] })) }) }
}
