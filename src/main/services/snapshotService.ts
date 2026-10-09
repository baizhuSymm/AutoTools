import type { AppSnapshot, Conversation, ToolCall, MonitorTask, ModelConfig } from '../../shared/agent'

export interface SnapshotSources {
  conversations: () => Conversation[]
  calls: () => ToolCall[]
  tasks: () => MonitorTask[]
  config: () => ModelConfig
  activeSessionId: () => string | null
  warning: () => string | undefined
}
export class SnapshotService {
  private sequence = 0
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  constructor(private sources: SnapshotSources, private publish: (snapshot: AppSnapshot) => void) {}
  snapshot(): AppSnapshot {
    return structuredClone({ sequence: this.sequence, conversations: this.sources.conversations(), calls: this.sources.calls(), tasks: this.sources.tasks(), config: this.sources.config(), activeSessionId: this.sources.activeSessionId(), warning: this.sources.warning() })
  }
  changed(): void {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; this.sequence++; this.publish(this.snapshot()) }, 80)
    this.timer.unref?.()
  }
  dispose(): void { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined }
}
