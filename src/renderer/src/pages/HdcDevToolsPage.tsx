import { useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Select, Space } from 'antd'
import { Globe, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useAgent } from '../features/agent/context'
import { useDevices } from '../features/agent/useDevices'
import type { ToolResult } from '../../../shared/agent'

export default function HdcDevToolsPage() {
  const { report } = useAgent()
  const device = useDevices()
  const [port, setPort] = useState(9222)
  const [socketName, setSocketName] = useState('webview_devtools_remote')
  const [browser, setBrowser] = useState('default')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ name: string; result: ToolResult }[]>([])
  const execute = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const result = await window.api.agent.execute(name, input)
    setResults((prior) => [...prior.slice(-49), { name, result }])
    return result
  }
  const run = async (action: 'probe' | 'all' | 'remove' | 'open'): Promise<void> => {
    if (!device.deviceId) return
    setBusy(true)
    try {
      const deviceId = device.deviceId
      if (action === 'probe') await execute('webview.probe', { deviceId })
      else if (action === 'remove') await execute('webview.remove_forward', { deviceId, port })
      else {
        if (action === 'all') {
          const enabled = await execute('webview.enable_debugging', { deviceId })
          if (enabled.status !== 'succeeded') return
          const forwarded = await execute('webview.forward_port', { deviceId, port, socketName })
          if (forwarded.status !== 'succeeded') return
        }
        await execute('webview.open_endpoint', { deviceId, port, browser })
      }
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tool-page">
      <header className="page-header">
        <h1>WebView 调试</h1>
        <Button
          type="text"
          aria-label="刷新设备"
          icon={<RefreshCw size={17} />}
          loading={device.busy}
          onClick={() => void device.refresh()}
        />
      </header>
      <div className="tool-content">
        {device.error && <Alert type="warning" title={device.error} />}
        <Form layout="vertical" className="tool-controls">
          <Form.Item label="设备">
            <Select
              style={{ width: 260 }}
              value={device.deviceId || undefined}
              placeholder="选择设备"
              onChange={device.setDeviceId}
              options={device.devices.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item label="本机端口">
            <InputNumber
              min={1}
              max={65535}
              value={port}
              onChange={(value) => {
                if (value) setPort(value)
              }}
            />
          </Form.Item>
          <Form.Item label="调试 socket">
            <Input
              value={socketName}
              onChange={(event) => setSocketName(event.target.value)}
              style={{ width: 260 }}
            />
          </Form.Item>
          <Form.Item label="浏览器">
            <Select
              style={{ width: 140 }}
              value={browser}
              onChange={setBrowser}
              options={[
                { value: 'default', label: '默认浏览器' },
                { value: 'chrome', label: 'Chrome' }
              ]}
            />
          </Form.Item>
        </Form>
        <Space wrap>
          <Button
            type="primary"
            icon={<Play size={16} />}
            loading={busy}
            disabled={!device.deviceId}
            onClick={() => void run('all')}
          >
            开启调试
          </Button>
          <Button
            icon={<Search size={16} />}
            disabled={busy || !device.deviceId}
            onClick={() => void run('probe')}
          >
            探测设备
          </Button>
          <Button
            icon={<Globe size={16} />}
            disabled={busy || !device.deviceId}
            onClick={() => void run('open')}
          >
            打开端点
          </Button>
          <Button
            danger
            icon={<Trash2 size={16} />}
            disabled={busy || !device.deviceId}
            onClick={() => void run('remove')}
          >
            移除转发
          </Button>
        </Space>
        <section className="tool-section" style={{ marginTop: 24 }}>
          <h2>执行记录</h2>
          {!results.length ? (
            <span className="muted">暂无执行记录</span>
          ) : (
            results.map(({ name, result }, index) => (
              <div key={index} style={{ marginBottom: 16 }}>
                <Alert
                  type={
                    result.status === 'succeeded'
                      ? 'success'
                      : result.status === 'failed'
                        ? 'error'
                        : 'warning'
                  }
                  title={`${name} · ${result.summary}`}
                />
                {result.data !== undefined && (
                  <pre className="structured-data">{JSON.stringify(result.data, null, 2)}</pre>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
