import { randomUUID } from 'node:crypto'
import type { CrashEvent } from '../../shared/ipc'
import type { MonitorTask } from '../../shared/agent'
import type { HdcStreamHandle } from '../services/hdcService'

const keywords: { re: RegExp; severity: CrashEvent['severity']; tag: string }[] = [
  { re: /\bFATAL\b|fatal\s+error/i, severity: 'fatal', tag: 'FATAL' },
  {
    re: /crashed|crash\s+signal|tombstone|\bsignal\s+(SIG[A-Z]+|\d+)/i,
    severity: 'fatal',
    tag: 'CRASH'
  },
  { re: /fault\s*logger|faultlogger|fault\s+event/i, severity: 'fatal', tag: 'FAULT' },
  {
    re: /JS\s+Error|Unhandled\s+Promise\s+rejection|TypeError|ReferenceError|NullPointer/i,
    severity: 'error',
    tag: 'JS-ERROR'
  },
  { re: /\bException\b/i, severity: 'error', tag: 'EXCEPTION' },
  { re: /\bE\s+C\d+|\bERROR\b/i, severity: 'error', tag: 'ERROR' },
  { re: /\bW\s+C\d+|\bWARN(?:ING)?\b/i, severity: 'warn', tag: 'WARN' }
]

interface Entry {
  task: MonitorTask
  handle: HdcStreamHandle
  buffer: string
  stopping?: Promise<void>
  closed: boolean
}

export class MonitorManager {
  private entries = new Map<string, Entry>()
  private notifyTimer?: ReturnType<typeof setTimeout>
  constructor(
    private spawn: (deviceId: string) => HdcStreamHandle,
    private changed: () => void
  ) {}

  list(): MonitorTask[] {
    return [...this.entries.values()].map(({ task }) => structuredClone(task))
  }
  snapshot(id: string): MonitorTask {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('监控任务不存在')
    return structuredClone(entry.task)
  }

  private notify(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined
      this.changed()
    }, 150)
    this.notifyTimer.unref?.()
  }

  private line(entry: Entry, line: string): void {
    const match = keywords.find((keyword) => keyword.re.test(line))
    if (!match) return
    if (Buffer.byteLength(line) > 16384) {
      line = Buffer.from(line).subarray(0, 16380).toString('utf8') + '...'
      entry.task.truncated++
    }
    const bundle =
      line.match(/bundleName\s*[:=]\s*([\w.]+)/i) || line.match(/process\s+([\w.]+)\s+crashed/i)
    entry.task.total++
    entry.task.events.push({
      id: entry.task.total,
      ts: Date.now(),
      raw: line,
      severity: match.severity,
      matchKeyword: match.tag,
      bundleName: bundle?.[1] ?? ''
    })
    if (entry.task.events.length > 500) entry.task.events.shift()
    this.notify()
  }

  start(deviceId: string, bundleName: string): MonitorTask {
    const running = [...this.entries.values()].find(
      ({ task, closed }) => task.deviceId === deviceId && task.bundleName === bundleName && !closed
    )
    if (running) return structuredClone(running.task)
    if (this.entries.size >= 100) {
      const old = [...this.entries.values()].find(({ closed }) => closed)
      if (old) this.entries.delete(old.task.id)
      else throw new Error('监控任务过多，请先停止任务')
    }
    const task: MonitorTask = {
      id: randomUUID(),
      deviceId,
      bundleName,
      status: 'starting',
      startedAt: Date.now(),
      canStop: true,
      events: [],
      total: 0,
      truncated: 0
    }
    const handle = this.spawn(deviceId)
    const entry: Entry = { task, handle, buffer: '', closed: false }
    this.entries.set(task.id, entry)
    const chunk = (data: string): void => {
      const lines = (entry.buffer + data).split(/\r?\n/)
      entry.buffer = lines.pop() ?? ''
      for (const line of lines) this.line(entry, line)
      if (Buffer.byteLength(entry.buffer) > 65536) {
        entry.buffer = Buffer.from(entry.buffer).subarray(0, 65530).toString('utf8')
        task.truncated++
      }
    }
    handle.on('stdout', chunk).on('stderr', chunk)
    handle.on('error', (error) => {
      task.status = 'failed'
      task.reason = error.message
      task.endedAt = Date.now()
      this.notify()
    })
    handle.on('close', (code) => {
      entry.closed = true
      task.canStop = false
      if (entry.buffer) this.line(entry, entry.buffer)
      entry.buffer = ''
      if (task.status !== 'failed') {
        task.status = task.status === 'stopping' || code === 0 ? 'stopped' : 'failed'
        task.reason = `进程退出 (${code})`
      }
      task.endedAt = Date.now()
      this.notify()
    })
    task.status = 'running'
    this.notify()
    return structuredClone(task)
  }

  async stop(id: string): Promise<MonitorTask> {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('监控任务不存在')
    if (entry.closed) return this.snapshot(id)
    if (!entry.stopping) {
      entry.task.status = 'stopping'
      this.notify()
      entry.stopping = entry.handle
        .stop()
        .then(() => {
          if (entry.task.status === 'stopping') {
            entry.task.status = 'failed'
            entry.task.reason = '未确认进程已退出'
            entry.task.endedAt = Date.now()
          }
        })
        .catch((error: unknown) => {
          entry.task.status = 'failed'
          entry.task.reason = error instanceof Error ? error.message : String(error)
        })
        .finally(() => {
          entry.stopping = undefined
          this.notify()
        })
    }
    await entry.stopping
    return this.snapshot(id)
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.entries.keys()].map((id) => this.stop(id)))
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
  }
}

export function monitorReport(task: MonitorTask): string {
  return [
    '# 崩溃事件汇总',
    `设备: ${task.deviceId}`,
    `目标应用: ${task.bundleName}`,
    `起始: ${new Date(task.startedAt).toISOString()}`,
    `累计匹配: ${task.total}`,
    `导出保留事件: ${task.events.length}`,
    `已丢弃: ${task.total - task.events.length}`,
    `截断次数: ${task.truncated}`,
    '仅为关键词匹配事件，不代表已确认的目标应用崩溃。',
    '',
    ...task.events.map(
      (event) =>
        `[${new Date(event.ts).toISOString()}] [${event.severity}] [${event.bundleName || '未知'}] ${event.raw}`
    )
  ].join('\n')
}
