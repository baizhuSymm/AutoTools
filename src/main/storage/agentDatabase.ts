import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Low } from 'lowdb'
import { parseAgentData, type AgentData } from './schema'

export const emptyAgentData = (): AgentData => ({ version: 1, conversations: [], history: {}, calls: [], tasks: [] })

export class AgentDatabase {
  private tail: Promise<void> = Promise.resolve()
  private failure?: unknown

  private constructor(private data: AgentData, private write: (data: AgentData) => Promise<void>) {}

  static async open(directory: string): Promise<AgentDatabase> {
    await mkdir(directory, { recursive: true })
    const { Low } = await import('lowdb')
    const { JSONFile } = await import('lowdb/node')
    const db: Low<AgentData> = new Low(new JSONFile(join(directory, 'agent-data.json')), emptyAgentData())
    await db.read()
    return new AgentDatabase(parseAgentData(db.data), async (data) => { db.data = data; await db.write() })
  }

  static unavailable(reason: string): AgentDatabase {
    return new AgentDatabase(emptyAgentData(), async () => { throw new Error(reason) })
  }

  read(): AgentData { return structuredClone(this.data) }

  update(change: (data: AgentData) => void): void {
    const next = this.read()
    change(next)
    this.data = parseAgentData(next)
  }

  // 捕获本次提交的副本，避免后续更新改变正在写入的数据。
  commit(): Promise<void> {
    const captured = this.read()
    const operation = this.tail.catch(() => {}).then(() => this.write(captured))
    this.tail = operation.then(() => { this.failure = undefined }, (error: unknown) => { this.failure = error; throw error })
    void this.tail.catch(() => {})
    return this.tail
  }

  async flush(): Promise<void> {
    await this.tail
    if (this.failure) throw this.failure
  }
}
