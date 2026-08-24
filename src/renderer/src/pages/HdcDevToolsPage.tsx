import { useCallback, useState } from 'react'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Col from 'react-bootstrap/Col'
import Container from 'react-bootstrap/Container'
import Form from 'react-bootstrap/Form'
import Row from 'react-bootstrap/Row'
import Spinner from 'react-bootstrap/Spinner'
import type { HdcExecResult } from '../../../shared/ipc'
import ConsolePanel from '../components/ConsolePanel'
import DeviceStatusPanel from '../components/DeviceStatusPanel'
import { useLogger } from '../hooks/useLogger'

const DEFAULT_PORT = 9222
const DEFAULT_SOCKET = 'webview_devtools_remote'

interface ProbeResult {
  webviewProcs: string[]
  devtoolsSockets: string[]
  forwarded: string[]
}

export default function HdcDevToolsPage() {
  const [port, setPort] = useState(DEFAULT_PORT)
  const [socketName, setSocketName] = useState(DEFAULT_SOCKET)
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const { log, error, clear, logs } = useLogger()

  const runHdc = useCallback(
    async (label: string, args: string[]): Promise<HdcExecResult | null> => {
      log(`$ hdc ${args.join(' ')}`)
      try {
        const result = await window.api.hdc.exec(args)
        if (result.code === 0) {
          log(`✓ ${label}`)
          const out = result.stdout.trim()
          if (out) log(out)
          return result
        }
        error(`✗ ${label} (exit ${result.code})`)
        const errOut = result.stderr.trim()
        if (errOut) error(errOut)
        return result
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        error(`${label} 异常: ${msg}`)
        return null
      }
    },
    [log, error]
  )

  const enableRemoteDebugging = useCallback(() => {
    return runHdc('开启 WebView 远程调试', [
      'shell',
      'setprop',
      'debug.webview.remote_debugging',
      'true'
    ])
  }, [runHdc])

  const setupPortForward = useCallback(() => {
    return runHdc(`端口转发 tcp:${port} ← ${socketName}`, [
      'fport',
      `tcp:${port}`,
      socketName
    ])
  }, [runHdc, port, socketName])

  const removePortForward = useCallback(() => {
    return runHdc(`移除端口转发 tcp:${port}`, ['fport', 'rm', `tcp:${port}`])
  }, [runHdc, port])

  const openJsonEndpoint = useCallback(
    async (label: string) => {
      const url = `http://localhost:${port}/json/list`
      try {
        log(`打开 ${url}`)
        await window.api.shell.openExternal(url)
        log(`✓ ${label}`)
        log('提示: 在打开的页面里点 webSocketDebuggerUrl 即可进入 DevTools')
      } catch (e) {
        error(`${label} 失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [log, error, port]
  )

  /**
   * 探测设备实际情况,辅助诊断:
   * - 当前 WebView 进程(决定是否有 socket 可连)
   * - 设备上的 devtools 相关 socket(决定正确的 socket 名)
   * - 已有的 fport 转发(决定 9222 是否被占用)
   */
  const runProbe = useCallback(async () => {
    const result: ProbeResult = {
      webviewProcs: [],
      devtoolsSockets: [],
      forwarded: []
    }
    log('=== 开始探测设备 ===')

    // 1. WebView 进程
    const procRes = await window.api.hdc.exec(['shell', 'ps', '-ef'])
    if (procRes.code === 0) {
      result.webviewProcs = procRes.stdout
        .split(/\r?\n/)
        .filter((l) => /webview|com\.android|chromium/i.test(l))
      log(`设备上 WebView 相关进程: ${result.webviewProcs.length} 个`)
      result.webviewProcs.slice(0, 5).forEach((p) => log(`  ${p.trim()}`))
    }

    // 2. devtools socket
    const sockRes = await window.api.hdc.exec(['shell', 'cat', '/proc/net/unix'])
    if (sockRes.code === 0) {
      result.devtoolsSockets = sockRes.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /devtools|webview_devtools/i.test(l))
      log(`设备上 devtools 相关 socket: ${result.devtoolsSockets.length} 个`)
      result.devtoolsSockets.forEach((s) => log(`  ${s}`))
      if (result.devtoolsSockets.length > 0) {
        const firstMatch = result.devtoolsSockets[0].match(/(\S*devtools\S*)/)
        if (firstMatch && !socketName.endsWith(firstMatch[1])) {
          log(`建议 socket 名: ${firstMatch[1]}`)
        }
      }
    }

    // 3. fport 列表
    const fportRes = await window.api.hdc.exec(['fport', 'ls'])
    if (fportRes.code === 0) {
      result.forwarded = fportRes.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      log(`当前 fport 转发: ${result.forwarded.length} 条`)
      result.forwarded.forEach((f) => log(`  ${f}`))
    }

    setProbe(result)
    log('=== 探测完成 ===')
  }, [log, socketName])

  const runAll = async () => {
    setBusy(true)
    clear()
    try {
      log('=== 一键开启 DevTools ===')
      const r1 = await enableRemoteDebugging()
      if (!r1 || r1.code !== 0) {
        error('第一步失败,中止')
        return
      }
      const r2 = await setupPortForward()
      if (!r2 || r2.code !== 0) {
        error('第二步失败,中止')
        return
      }
      await openJsonEndpoint('默认浏览器已打开 DevTools 端点')
      log('=== 完成 ===')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container fluid className="py-3" style={{ paddingBottom: 240 }}>
      <div className="d-flex align-items-center mb-3">
        <i className="bi bi-bug me-2" style={{ fontSize: 22 }} />
        <h4 className="mb-0">HDC DevTools</h4>
      </div>

      <Row className="g-3">
        <Col xs={12} lg={8}>
          <Card>
            <Card.Header>
              <i className="bi bi-terminal me-2" />
              开启 WebView DevTools
            </Card.Header>
            <Card.Body>
              <Alert variant="info" className="small mb-3">
                <strong>流程:</strong>
                <ol className="mb-0 mt-1 ps-3">
                  <li>在鸿蒙设备上开启 WebView 远程调试属性</li>
                  <li>通过 hdc fport 把设备的 localabstract 端口转发到本机</li>
                  <li>打开 <code>http://localhost:{port}/json/list</code>,点 webSocketDebuggerUrl 进入 DevTools</li>
                </ol>
              </Alert>

              <Row className="g-2 mb-3">
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small mb-1">本机端口</Form.Label>
                    <Form.Control
                      type="number"
                      value={port}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setPort(Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT)
                      }}
                      min={1}
                      max={65535}
                    />
                    <Form.Text className="text-secondary">默认 9222</Form.Text>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label className="small mb-1">设备 socket 名</Form.Label>
                    <Form.Control
                      type="text"
                      value={socketName}
                      onChange={(e) => setSocketName(e.target.value)}
                    />
                    <Form.Text className="text-secondary">
                      点「探测」可看到设备上真实的 socket 名
                    </Form.Text>
                  </Form.Group>
                </Col>
              </Row>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <Button variant="primary" onClick={runAll} disabled={busy}>
                  {busy ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-2" />
                      执行中...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-fill me-1" />
                      一键开启 DevTools
                    </>
                  )}
                </Button>
                <Button variant="outline-info" onClick={runProbe} disabled={busy}>
                  <i className="bi bi-search me-1" />
                  探测设备
                </Button>
                <Button variant="outline-secondary" onClick={removePortForward} disabled={busy}>
                  <i className="bi bi-x-circle me-1" />
                  移除端口转发
                </Button>
              </div>

              {/* 探测结果展示 */}
              {probe && (
                <Alert variant="secondary" className="small mb-3">
                  <div>
                    <strong>WebView 进程:</strong>
                    {probe.webviewProcs.length === 0
                      ? <span className="text-warning ms-1">未发现(需先在设备上打开含 WebView 的 App)</span>
                      : <span className="text-success ms-1">{probe.webviewProcs.length} 个</span>}
                  </div>
                  <div className="mt-1">
                    <strong>devtools socket:</strong>
                    {probe.devtoolsSockets.length === 0
                      ? <span className="text-warning ms-1">未发现(socket 名可能不对,或 WebView 未启动)</span>
                      : (
                        <ul className="mb-0 mt-1 ps-3">
                          {probe.devtoolsSockets.map((s, i) => {
                            const m = s.match(/(\S*devtools\S*)/)
                            const name = m ? m[1] : s
                            return (
                              <li key={i}>
                                <code>{name}</code>
                                {name !== socketName && (
                                  <Button
                                    size="sm"
                                    variant="link"
                                    className="p-0 ms-2"
                                    onClick={() => setSocketName(name)}
                                  >
                                    用这个
                                  </Button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                  </div>
                  <div className="mt-1">
                    <strong>当前 fport:</strong>
                    {probe.forwarded.length === 0
                      ? <span className="text-muted ms-1">无</span>
                      : (
                        <ul className="mb-0 mt-1 ps-3">
                          {probe.forwarded.map((f, i) => <li key={i}><code>{f}</code></li>)}
                        </ul>
                      )}
                  </div>
                </Alert>
              )}

              <Row className="g-2">
                <Col md={4}>
                  <Card body className="h-100">
                    <h6 className="mb-2">
                      <span className="badge bg-secondary me-2">1</span>
                      开启远程调试
                    </h6>
                    <p className="text-secondary small mb-2" style={{ minHeight: 36 }}>
                      设置设备的 <code>debug.webview.remote_debugging</code> 属性
                    </p>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={enableRemoteDebugging}
                      disabled={busy}
                    >
                      <i className="bi bi-play me-1" />
                      执行
                    </Button>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card body className="h-100">
                    <h6 className="mb-2">
                      <span className="badge bg-secondary me-2">2</span>
                      端口转发
                    </h6>
                    <p className="text-secondary small mb-2" style={{ minHeight: 36 }}>
                      转发 <code>{socketName}</code> 到本机 {port}
                    </p>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={setupPortForward}
                      disabled={busy}
                    >
                      <i className="bi bi-play me-1" />
                      执行
                    </Button>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card body className="h-100">
                    <h6 className="mb-2">
                      <span className="badge bg-secondary me-2">3</span>
                      打开 DevTools
                    </h6>
                    <p className="text-secondary small mb-2" style={{ minHeight: 36 }}>
                      用默认浏览器打开 <code>/json/list</code>
                    </p>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => openJsonEndpoint('DevTools 端点已打开')}
                      disabled={busy}
                    >
                      <i className="bi bi-globe me-1" />
                      打开 DevTools 端点
                    </Button>
                  </Card>
                </Col>
              </Row>
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
