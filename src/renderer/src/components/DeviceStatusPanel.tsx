import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import Alert from 'react-bootstrap/Alert'
import Badge from 'react-bootstrap/Badge'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Form from 'react-bootstrap/Form'
import ListGroup from 'react-bootstrap/ListGroup'

const POLL_INTERVAL_MS = 5000

export interface DeviceStatusPanelProps {
  /** 自动刷新间隔(毫秒),设为 0 关闭 */
  pollInterval?: number
}

export default function DeviceStatusPanel({
  pollInterval = POLL_INTERVAL_MS
}: DeviceStatusPanelProps) {
  const [devices, setDevices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.agent.execute('device.list', {})
      if (result.status === 'succeeded') {
        const list = result.data as string[]
        setDevices(list)
      } else {
        setError(result.summary)
        setDevices([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDevices([])
    } finally {
      setLoading(false)
      setLastChecked(new Date())
    }
  }, [])

  // 首次加载
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  // 定时轮询
  useEffect(() => {
    if (!autoRefresh || pollInterval <= 0) return
    const timer = setInterval(refresh, pollInterval)
    return () => clearInterval(timer)
  }, [autoRefresh, pollInterval, refresh])

  const handleToggleAuto = (e: ChangeEvent<HTMLInputElement>) => {
    setAutoRefresh(e.target.checked)
  }

  const isOnline = devices.length > 0 && !error

  return (
    <Card>
      <Card.Header className="d-flex align-items-center justify-content-between">
        <span>
          <i className="bi bi-hdd-network me-2" />
          鸿蒙设备
          <Badge bg={isOnline ? 'success' : 'secondary'} className="ms-2 fw-normal">
            {isOnline ? '已连接' : '未连接'}
          </Badge>
        </span>
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={refresh}
          disabled={loading}
          title="刷新"
        >
          <i
            className={`bi bi-arrow-clockwise ${loading ? 'spinner-border spinner-border-sm' : ''}`}
          />
        </Button>
      </Card.Header>
      <Card.Body>
        <Form.Check
          type="switch"
          id="device-auto-refresh"
          label={`自动刷新(${Math.round(pollInterval / 1000)}秒)`}
          checked={autoRefresh}
          onChange={handleToggleAuto}
          className="mb-3 small"
        />

        {error && (
          <Alert variant="warning" className="small mb-2">
            <i className="bi bi-exclamation-triangle me-1" />
            {error}
            <div className="text-secondary mt-1" style={{ fontSize: 11 }}>
              请确认已安装 hdc 工具,且设备已开启 USB 调试
            </div>
          </Alert>
        )}

        {!error && devices.length === 0 && !loading && (
          <div className="text-secondary text-center py-3 small">
            <i className="bi bi-phone" style={{ fontSize: 24, opacity: 0.4 }} />
            <div className="mt-1">未检测到设备</div>
          </div>
        )}

        {devices.length > 0 && (
          <ListGroup variant="flush" className="mb-2">
            {devices.map((id) => (
              <ListGroup.Item key={id} className="d-flex align-items-center px-0 py-2 small">
                <span
                  className="bg-success rounded-circle me-2 flex-shrink-0"
                  style={{ width: 8, height: 8 }}
                />
                <span className="font-monospace text-break">{id}</span>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}

        <div className="text-secondary" style={{ fontSize: 11 }}>
          {lastChecked ? `更新于 ${lastChecked.toLocaleTimeString()}` : '尚未检查'}
        </div>
      </Card.Body>
    </Card>
  )
}
