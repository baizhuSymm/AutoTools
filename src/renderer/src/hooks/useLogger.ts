import { useCallback, useRef, useState } from 'react'

export type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: number
  method: LogMethod
  args: unknown[]
  time: string
}

const DEFAULT_MAX = 1000

export interface UseLoggerResult {
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  clear: () => void
  logs: LogEntry[]
}

/**
 * 组件级日志记录。id 自增避免 Date.now()+Math.random() 的潜在碰撞；
 * 超出 maxEntries 时丢弃最旧条目防止内存膨胀。
 */
export function useLogger(maxEntries: number = DEFAULT_MAX): UseLoggerResult {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const idRef = useRef(0)

  const append = useCallback(
    (method: LogMethod, args: unknown[]) => {
      const id = ++idRef.current
      const entry: LogEntry = {
        id,
        method,
        args,
        time: new Date().toLocaleTimeString()
      }
      setLogs((prev) => {
        const next = prev.length >= maxEntries ? prev.slice(prev.length - maxEntries + 1) : prev.slice()
        next.push(entry)
        return next
      })
    },
    [maxEntries]
  )

  const log = useCallback((...args: unknown[]) => append('log', args), [append])
  const info = useCallback((...args: unknown[]) => append('info', args), [append])
  const warn = useCallback((...args: unknown[]) => append('warn', args), [append])
  const error = useCallback((...args: unknown[]) => append('error', args), [append])
  const debug = useCallback((...args: unknown[]) => append('debug', args), [append])
  const clear = useCallback(() => setLogs([]), [])

  return { log, info, warn, error, debug, clear, logs }
}
