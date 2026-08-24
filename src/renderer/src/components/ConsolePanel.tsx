import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { LogEntry } from '../hooks/useLogger'

export interface ConsolePanelProps {
  logs: LogEntry[]
  onClear: () => void
}

const MIN_HEIGHT = 100
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 200

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export default function ConsolePanel({ logs, onClear }: ConsolePanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta))
      setHeight(newHeight)
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height])

  // 关闭时确保 listeners 清掉
  useEffect(() => {
    if (!isResizing) return
    return () => {
      // 不在这里清，handleMouseUp 会处理
    }
  }, [isResizing])

  const currentHeight = collapsed ? 36 : height

  return (
    <div
      ref={containerRef}
      className="position-fixed bottom-0 end-0 border-top border-secondary shadow-lg bg-body"
      style={{
        left: 'var(--sidebar-width)',
        right: 0,
        height: currentHeight,
        zIndex: 1050,
        display: 'flex',
        flexDirection: 'column',
        userSelect: isResizing ? 'none' : 'auto'
      }}
    >
      {/* 顶部工具栏 + 拖动条 */}
      <div
        className="d-flex align-items-center justify-content-between px-3 bg-body-secondary border-bottom border-secondary"
        style={{ height: 36, cursor: 'row-resize', flexShrink: 0 }}
        onMouseDown={handleMouseDown}
      >
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-terminal" style={{ fontSize: 14 }} />
          <small className="text-secondary">
            {collapsed ? '控制台' : `${logs.length} 条日志`}
          </small>
        </div>
        <div className="d-flex align-items-center gap-1">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="清空日志"
          >
            <i className="bi bi-trash" />
            {!collapsed && <span>清空</span>}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={collapsed ? '展开' : '折叠'}
          >
            <i className={`bi bi-chevron-${collapsed ? 'up' : 'down'}`} />
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      {!collapsed && (
        <div className="flex-grow-1 overflow-auto bg-body-tertiary p-2">
          {logs.length === 0 ? (
            <div className="text-center text-secondary py-4 small">暂无日志</div>
          ) : (
            logs.map((item) => (
              <div key={item.id} className={`console-line console-${item.method}`}>
                <span className="console-time">[{item.time}]</span>
                {item.args.map(stringifyArg).join(' ')}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
