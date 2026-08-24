import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncSelect from 'react-select/async'
import type { StylesConfig } from 'react-select'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Container from 'react-bootstrap/Container'
import Form from 'react-bootstrap/Form'
import InputGroup from 'react-bootstrap/InputGroup'
import Row from 'react-bootstrap/Row'
import Spinner from 'react-bootstrap/Spinner'
import Table from 'react-bootstrap/Table'
import type { CrashEvent, HdcStreamEventPayload } from '../../../shared/ipc'
import ConsolePanel from '../components/ConsolePanel'
import DeviceStatusPanel from '../components/DeviceStatusPanel'
import { useLogger } from '../hooks/useLogger'

interface BundleOption {
  value: string
  label: string
}

/** 命中崩溃/异常的关键字,按严重度从高到低 */
const KEYWORDS: { re: RegExp; severity: CrashEvent['severity']; tag: string }[] = [
  { re: /\bFATAL\b|\bfatal\b|fatal\s+error/i, severity: 'fatal', tag: 'FATAL' },
  { re: /crashed|crash\s+signal|tombstone|\bsignal\s+(SIG[A-Z]+|\d+)/i, severity: 'fatal', tag: 'CRASH' },
  { re: /fault\s*logger|faultlogger|fault\s+event/i, severity: 'fatal', tag: 'FAULT' },
  { re: /JS\s+Error|Unhandled\s+Promise\s+rejection|TypeError|ReferenceError|NullPointer/i, severity: 'error', tag: 'JS-ERROR' },
  { re: /\bException\b/i, severity: 'error', tag: 'EXCEPTION' },
  { re: /\bE\s+C\d+|\bERROR\b/i, severity: 'error', tag: 'ERROR' },
  { re: /\bW\s+C\d+|\bWARN(?:ING)?\b/i, severity: 'warn', tag: 'WARN' }
]

/** 从一行 hilog 里尽力提取 bundle 名 */
function extractBundleName(line: string): string {
  const m =
    line.match(/bundleName\s*[:=]\s*([\w.]+)/i) ||
    line.match(/process\s+([\w.]+)\s+crashed/i) ||
    line.match(/\b([\w]+(?:\.[\w]+){1,})\b/) // 兜底:任意 a.b.c 形式
  return m && m[1] ? m[1] : ''
}

function classify(line: string): { severity: CrashEvent['severity']; keyword: string } {
  for (const k of KEYWORDS) {
    const m = line.match(k.re)
    if (m) return { severity: k.severity, keyword: `${k.tag}: ${m[0]}` }
  }
  return { severity: 'info', keyword: '' }
}

function defaultExportDir(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `crashlogs/${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

const SELECT_STYLES: StylesConfig<BundleOption, false> = {
  control: (base) => ({ ...base, minHeight: 38, backgroundColor: 'var(--bs-body-bg)' }),
  menu: (base) => ({ ...base, zIndex: 1100 })
}

const MAX_EVENTS = 500

export default function CrashMonitorPage() {
  const [bundleInput, setBundleInput] = useState('')
  const [monitoring, setMonitoring] = useState(false)
  const [streamId, setStreamId] = useState<string | null>(null)
  const [events, setEvents] = useState<CrashEvent[]>([])
  const [targetBundle, setTargetBundle] = useState<string>('')
  const [exportDir, setExportDir] = useState('')
  const [lastExport, setLastExport] = useState<string | null>(null)
  const [foregroundBusy, setForegroundBusy] = useState(false)
  const [deviceConnected, setDeviceConnected] = useState(false)

  const idRef = useRef(0)
  const lineBufferRef = useRef('')
  const monitorStartRef = useRef<number | null>(null)
  const eventsRef = useRef<CrashEvent[]>([])
  const { log, info, warn, error, clear, logs } = useLogger()

  // 同步最新 events 到 ref,导出时拿到全量
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  // 启动时探测设备
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    ;(async () => {
      try {
        const r = await window.api.hdc.exec(['list', 'targets'])
        setDeviceConnected(r.code === 0 && r.stdout.trim().length > 0)
      } catch {
        setDeviceConnected(false)
      }
    })()
  }, [])

  // AsyncSelect 的 loadOptions:从设备拉取 bundle 列表
  const loadBundleOptions = useCallback(
    async (input: string): Promise<BundleOption[]> => {
      try {
        const list = await window.api.hdc.listBundles()
        const lower = input.trim().toLowerCase()
        const filtered = lower
          ? list.filter((b) => b.toLowerCase().includes(lower))
          : list
        return filtered.slice(0, 200).map((b) => ({ value: b, label: b }))
      } catch (e) {
        error(`获取应用列表失败: ${e instanceof Error ? e.message : String(e)}`)
        return []
      }
    },
    [error]
  )

  // 订阅主进程推送的流事件
  useEffect(() => {
    const off = window.api.hdc.onStreamEvent((payload: HdcStreamEventPayload) => {
      if (!streamId || payload.streamId !== streamId) return
      if (payload.type === 'stdout') {
        handleStreamChunk(payload.data)
      } else if (payload.type === 'stderr') {
        // hilog 偶尔会从 stderr 吐数据,当作 stdout 处理
        handleStreamChunk(payload.data)
      } else if (payload.type === 'close') {
        info(`hdc 流已结束(code=${payload.code})`)
        setMonitoring(false)
        setStreamId(null)
      } else if (payload.type === 'error') {
        error(`hdc 流错误: ${payload.message}`)
        setMonitoring(false)
        setStreamId(null)
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId])

  /** 处理 hilog 的一帧输出,按 \n 切行,逐行分类 */
  const handleStreamChunk = useCallback(
    (chunk: string) => {
      const combined = lineBufferRef.current + chunk
      const lines = combined.split(/\r?\n/)
      // 最后一段可能不完整,留到下一次
      lineBufferRef.current = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const { severity, keyword } = classify(line)
        // 只保留 fatal/error/warn,info 的也写一条普通日志便于排错
        if (severity === 'info') continue

        const bundle = extractBundleName(line)
        const id = ++idRef.current
        const ev: CrashEvent = {
          id,
          ts: Date.now(),
          raw: line,
          severity,
          matchKeyword: keyword,
          bundleName: bundle
        }

        setEvents((prev) => {
          const next = prev.length >= MAX_EVENTS ? prev.slice(prev.length - MAX_EVENTS + 1) : prev.slice()
          next.push(ev)
          return next
        })

        const isTarget = targetBundle && bundle === targetBundle
        const tag = isTarget ? '🎯 命中目标包' : '捕获'
        if (severity === 'fatal' || isTarget) {
          error(`${tag} [${severity.toUpperCase()}] ${line}`)
        } else if (severity === 'error') {
          warn(`${tag} [${severity.toUpperCase()}] ${line}`)
        } else {
          info(`${tag} [${severity.toUpperCase()}] ${line}`)
        }
      }
    },
    [targetBundle, error, warn, info]
  )

  const handleGetForeground = useCallback(async (): Promise<void> => {
    setForegroundBusy(true)
    try {
      const fg = await window.api.hdc.getForeground()
      if (fg) {
        setBundleInput(fg)
        setTargetBundle(fg)
        log(`✓ 已填入前台应用: ${fg}`)
      } else {
        warn('未能识别当前前台应用')
      }
    } catch (e) {
      error(`获取前台应用失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setForegroundBusy(false)
    }
  }, [log, warn, error])

  const handleBundleChange = useCallback((v: string) => {
    setBundleInput(v)
    setTargetBundle(v.trim())
  }, [])

  const handleStart = useCallback(async (): Promise<void> => {
    const bundle = bundleInput.trim()
    if (!bundle) {
      warn('请先填写或选择应用包名')
      return
    }
    if (monitoring) return
    clear()
    idRef.current = 0
    lineBufferRef.current = ''
    setEvents([])
    monitorStartRef.current = Date.now()
    setLastExport(null)

    // 用 -T faultlogger + -T AppMgr,覆盖闪退与进程退出事件
    const args = ['shell', 'hilog', '-T', 'faultlogger', '-T', 'AppMgr']
    log(`启动监控命令: hdc ${args.join(' ')}`)
    log(`目标包名: ${bundle}`)

    try {
      const { streamId: sid } = await window.api.hdc.streamStart(args)
      setStreamId(sid)
      setMonitoring(true)
      log(`✓ 监控已启动(streamId=${sid})`)
    } catch (e) {
      error(`启动监控失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [bundleInput, monitoring, log, warn, error, clear])

  const handleStop = useCallback(async (): Promise<void> => {
    if (!streamId) {
      setMonitoring(false)
      return
    }
    try {
      const r = await window.api.hdc.streamStop(streamId)
      log(`✓ 已停止监控(ok=${r.ok})`)
    } catch (e) {
      error(`停止监控失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setStreamId(null)
      setMonitoring(false)
    }
  }, [streamId, log, error])

  // 组件卸载时确保流停掉
  useEffect(() => {
    return () => {
      if (streamId) {
        window.api.hdc.streamStop(streamId).catch(() => undefined)
      }
    }
  }, [streamId])

  const handlePickExportDir = useCallback(async (): Promise<void> => {
    const picked = await window.api.selectFolder()
    if (picked) setExportDir(picked)
  }, [])

  const handleExport = useCallback(async (): Promise<void> => {
    const list = eventsRef.current
    if (list.length === 0) {
      warn('暂无崩溃事件可导出')
      return
    }
    const baseDir = exportDir.trim() || defaultExportDir()
    const ts = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
    const safeBundle = (targetBundle || 'unknown').replace(/[^\w.]/g, '_')

    const summaryLines: string[] = []
    summaryLines.push(`# 崩溃事件汇总`)
    summaryLines.push(`导出时间: ${ts.toLocaleString()}`)
    summaryLines.push(`目标包名: ${targetBundle || '(未指定)'}`)
    summaryLines.push(`事件总数: ${list.length}`)
    summaryLines.push(
      `监控起始: ${monitorStartRef.current ? new Date(monitorStartRef.current).toLocaleString() : '(未知)'}`
    )
    summaryLines.push(`hdc 命令: hdc shell hilog -T faultlogger -T AppMgr`)
    summaryLines.push('')
    summaryLines.push('--- 统计 ---')
    const stats: Record<string, number> = {}
    for (const ev of list) stats[ev.severity] = (stats[ev.severity] ?? 0) + 1
    for (const [k, v] of Object.entries(stats)) {
      summaryLines.push(`  ${k.toUpperCase()}: ${v}`)
    }
    summaryLines.push('')
    summaryLines.push('--- 事件列表 ---')
    for (const ev of list) {
      summaryLines.push(
        `[${new Date(ev.ts).toISOString()}] [${ev.severity.toUpperCase()}] ${ev.matchKeyword}`
      )
      summaryLines.push(`  bundle: ${ev.bundleName || '(未知)'}`)
      summaryLines.push(`  raw: ${ev.raw}`)
      summaryLines.push('')
    }
    const summary = summaryLines.join('\n')

    const raw = list.map((ev) => ev.raw).join('\n') + '\n'
    const summaryPath = `${baseDir}/${safeBundle}_summary_${stamp}.txt`
    const rawPath = `${baseDir}/${safeBundle}_raw_${stamp}.log`

    try {
      await window.api.file.writeText(summaryPath, summary)
      await window.api.file.writeText(rawPath, raw)
      setLastExport(summaryPath)
      log(`✓ 已导出: ${summaryPath}`)
      log(`✓ 已导出: ${rawPath}`)
    } catch (e) {
      error(`导出失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [exportDir, targetBundle, log, warn, error])

  const stats = useMemo(() => {
    const s = { fatal: 0, error: 0, warn: 0, targetHit: 0 }
    for (const ev of events) {
      if (ev.severity === 'fatal') s.fatal++
      else if (ev.severity === 'error') s.error++
      else if (ev.severity === 'warn') s.warn++
      if (targetBundle && ev.bundleName === targetBundle) s.targetHit++
    }
    return s
  }, [events, targetBundle])

  const durationSec = monitorStartRef.current
    ? Math.floor((Date.now() - monitorStartRef.current) / 1000)
    : 0

  return (
    <Container fluid className="py-3">
      <Row className="g-3">
        <Col xs={12} lg={8}>
          <Card className="mb-3">
            <Card.Header className="d-flex align-items-center justify-content-between">
              <span>
                <i className="bi bi-bug me-2 text-danger" />
                应用闪退监控
                <Badge bg={monitoring ? 'danger' : 'secondary'} className="ms-2 fw-normal">
                  {monitoring ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-1" />
                      监控中
                    </>
                  ) : (
                    '未启动'
                  )}
                </Badge>
              </span>
              {monitoring && (
                <span className="text-secondary small font-monospace">
                  已运行 {durationSec}s · 已捕获 {events.length}
                </span>
              )}
            </Card.Header>
            <Card.Body>
              <Alert variant="info" className="small mb-3">
                基于 <code>hdc shell hilog -T faultlogger -T AppMgr</code> 实时监听,匹配
                crash/fault/exception/signal 等关键字。命中目标包会标 🎯。
              </Alert>

              <Row className="g-2 mb-3">
                <Col xs={12}>
                  <Form.Label className="small mb-1">应用包名(BundleName)</Form.Label>
                  <InputGroup>
                    <div style={{ flex: 1 }}>
                      <AsyncSelect<BundleOption, false>
                        cacheOptions
                        defaultOptions
                        loadOptions={loadBundleOptions}
                        value={bundleInput ? { value: bundleInput, label: bundleInput } : null}
                        onChange={(opt) => handleBundleChange(opt?.value ?? '')}
                        onInputChange={(v, meta) => {
                          if (meta.action === 'input-change') handleBundleChange(v)
                          return v
                        }}
                        placeholder="选择设备已安装应用,或直接输入包名"
                        isClearable
                        styles={SELECT_STYLES}
                        noOptionsMessage={({ inputValue }) =>
                          inputValue ? `未匹配到包含 "${inputValue}" 的应用` : '暂无可选项'
                        }
                        loadingMessage={() => '加载中...'}
                      />
                    </div>
                    <Button
                      variant="outline-secondary"
                      onClick={handleGetForeground}
                      disabled={foregroundBusy || monitoring}
                      title="获取当前前台应用包名"
                    >
                      {foregroundBusy ? (
                        <Spinner as="span" animation="border" size="sm" />
                      ) : (
                        <>
                          <i className="bi bi-phone-landscape me-1" />
                          前台应用
                        </>
                      )}
                    </Button>
                  </InputGroup>
                </Col>
              </Row>

              <Row className="g-2 mb-3">
                <Col xs={12}>
                  <Form.Label className="small mb-1">导出目录(留空使用默认 ./crashlogs/&lt;时间戳&gt;)</Form.Label>
                  <InputGroup>
                    <Form.Control
                      placeholder="例如 D:\\crashlogs 或留空"
                      value={exportDir}
                      onChange={(e) => setExportDir(e.target.value)}
                      disabled={monitoring}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={handlePickExportDir}
                      disabled={monitoring}
                      title="选择目录"
                    >
                      <i className="bi bi-folder2-open me-1" />
                      浏览
                    </Button>
                  </InputGroup>
                </Col>
              </Row>

              <div className="d-flex flex-wrap gap-2 mb-3">
                {!monitoring ? (
                  <Button
                    variant="danger"
                    onClick={handleStart}
                    disabled={!deviceConnected}
                  >
                    <i className="bi bi-record-circle me-1" />
                    开始监控
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={handleStop}>
                    <i className="bi bi-stop-circle me-1" />
                    停止监控
                  </Button>
                )}
                <Button
                  variant="outline-primary"
                  onClick={handleExport}
                  disabled={events.length === 0}
                  title="把已捕获的事件导出到上方目录"
                >
                  <i className="bi bi-download me-1" />
                  导出事件({events.length})
                </Button>
                {!deviceConnected && (
                  <span className="text-warning align-self-center small">
                    <i className="bi bi-exclamation-triangle me-1" />
                    未检测到设备
                  </span>
                )}
              </div>

              {events.length > 0 && (
                <Row className="g-2 mb-3">
                  <Col xs={6} md={3}>
                    <Card body className="text-center py-2">
                      <div className="text-secondary small">FATAL</div>
                      <div className="fs-4 fw-bold text-danger">{stats.fatal}</div>
                    </Card>
                  </Col>
                  <Col xs={6} md={3}>
                    <Card body className="text-center py-2">
                      <div className="text-secondary small">ERROR</div>
                      <div className="fs-4 fw-bold text-warning">{stats.error}</div>
                    </Card>
                  </Col>
                  <Col xs={6} md={3}>
                    <Card body className="text-center py-2">
                      <div className="text-secondary small">WARN</div>
                      <div className="fs-4 fw-bold text-info">{stats.warn}</div>
                    </Card>
                  </Col>
                  <Col xs={6} md={3}>
                    <Card body className="text-center py-2">
                      <div className="text-secondary small">🎯 命中目标</div>
                      <div className="fs-4 fw-bold text-primary">{stats.targetHit}</div>
                    </Card>
                  </Col>
                </Row>
              )}

              {lastExport && (
                <Alert variant="success" className="small py-2 mb-3">
                  <i className="bi bi-check-circle me-1" />
                  上次导出: <code className="text-break">{lastExport}</code>
                </Alert>
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header className="d-flex align-items-center justify-content-between">
              <span>
                <i className="bi bi-list-ul me-2" />
                崩溃事件({events.length}/{MAX_EVENTS})
              </span>
              {events.length > 0 && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    setEvents([])
                    log('已清空事件列表')
                  }}
                >
                  <i className="bi bi-trash me-1" />
                  清空
                </Button>
              )}
            </Card.Header>
            <Card.Body className="p-0">
              {events.length === 0 ? (
                <div className="text-center text-secondary py-5 small">
                  <i className="bi bi-shield-check" style={{ fontSize: 32, opacity: 0.4 }} />
                  <div className="mt-2">
                    {monitoring ? '监控中,等待事件…' : '尚未开始监控'}
                  </div>
                </div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <Table size="sm" hover className="mb-0 font-monospace small">
                    <thead className="sticky-top bg-body">
                      <tr>
                        <th style={{ width: 90 }}>时间</th>
                        <th style={{ width: 70 }}>等级</th>
                        <th style={{ width: 110 }}>关键字</th>
                        <th style={{ width: 180 }}>包名</th>
                        <th>原始日志</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events
                        .slice()
                        .reverse()
                        .map((ev) => {
                          const isTarget = targetBundle && ev.bundleName === targetBundle
                          return (
                            <tr key={ev.id} className={isTarget ? 'table-danger' : ''}>
                              <td className="text-secondary">{formatTs(ev.ts)}</td>
                              <td>
                                <Badge
                                  bg={
                                    ev.severity === 'fatal'
                                      ? 'danger'
                                      : ev.severity === 'error'
                                        ? 'warning'
                                        : 'info'
                                  }
                                >
                                  {ev.severity.toUpperCase()}
                                </Badge>
                              </td>
                              <td className="text-break">{ev.matchKeyword}</td>
                              <td className="text-break">
                                {ev.bundleName || <span className="text-secondary">—</span>}
                                {isTarget && <span className="ms-1">🎯</span>}
                              </td>
                              <td className="text-break" style={{ whiteSpace: 'pre-wrap' }}>
                                {ev.raw}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} lg={4}>
          <DeviceStatusPanel />
        </Col>
      </Row>

      <ConsolePanel logs={logs} onClear={clear} />
    </Container>
  )
}