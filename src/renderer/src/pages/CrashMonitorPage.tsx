import { useState } from 'react'
import { Alert, AutoComplete, Button, Form, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import { Download, FolderOpen, Play, RefreshCw, Smartphone, Square, Trash2 } from 'lucide-react'
import { useAgent } from '../features/agent/context'
import { useDevices } from '../features/agent/useDevices'
import type { CrashEvent } from '../../../shared/ipc'

export default function CrashMonitorPage() {
  const { snapshot, report } = useAgent()
  const device = useDevices()
  const [bundleName, setBundleName] = useState('')
  const [bundles, setBundles] = useState<string[]>([])
  const [directory, setDirectory] = useState('')
  const [selectedTask, setSelectedTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState('')
  const [hiddenThrough, setHiddenThrough] = useState<Record<string, number>>({})
  const task = snapshot.tasks.find((item) => item.id === selectedTask) ?? snapshot.tasks.at(-1)
  const events = task?.events.filter((event) => event.id > (hiddenThrough[task.id] ?? 0)) ?? []
  const active = task && ['running', 'starting', 'stopping'].includes(task.status)
  const run = async (name: string, input: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.agent.execute(name, input)
      setLastResult(result.summary)
      if (result.status === 'failed') report(result.summary)
      if (name === 'crash.start' && result.status === 'succeeded')
        setSelectedTask((result.data as { id: string }).id)
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  const loadApps = async (): Promise<void> => {
    if (!device.deviceId) return
    try {
      const result = await window.api.agent.execute('device.list_apps', {
        deviceId: device.deviceId
      })
      if (result.status !== 'succeeded') throw new Error(result.summary)
      setBundles(result.data as string[])
    } catch (error) {
      report(error)
    }
  }
  return (
    <div className="tool-page">
      <header className="page-header">
        <h1>闪退监控</h1>
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
              style={{ width: 240 }}
              placeholder="选择设备"
              value={device.deviceId || undefined}
              onChange={(id) => {
                device.setDeviceId(id)
                setBundles([])
              }}
              options={device.devices.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item label="应用包名">
            <AutoComplete
              value={bundleName}
              onChange={setBundleName}
              onFocus={() => void loadApps()}
              style={{ width: 300 }}
              options={bundles
                .filter((name) => name.toLowerCase().includes(bundleName.toLowerCase()))
                .slice(0, 100)
                .map((value) => ({ value }))}
            >
              <Input placeholder="应用包名" />
            </AutoComplete>
          </Form.Item>
          <Tooltip title="获取前台应用">
            <Button
              aria-label="获取前台应用"
              icon={<Smartphone size={17} />}
              disabled={!device.deviceId}
              onClick={() => {
                void window.api.agent
                  .execute('device.foreground_app', { deviceId: device.deviceId })
                  .then((result) => {
                    const name = (result.data as { bundleName?: string } | undefined)?.bundleName
                    if (name) setBundleName(name)
                    else report(result.summary)
                  })
                  .catch(report)
              }}
            />
          </Tooltip>
          <Button
            type="primary"
            style={{ background: '#198754' }}
            icon={<Play size={16} />}
            loading={busy}
            disabled={!device.deviceId || !bundleName.trim()}
            onClick={() =>
              void run('crash.start', { deviceId: device.deviceId, bundleName: bundleName.trim() })
            }
          >
            开始监控
          </Button>
        </Form>
        <section className="tool-section">
          <h2>监控任务</h2>
          <Select
            style={{ width: '100%', maxWidth: 650 }}
            value={task?.id}
            placeholder="暂无任务"
            onChange={setSelectedTask}
            options={snapshot.tasks.map((item) => ({
              value: item.id,
              label: `${item.bundleName} · ${item.deviceId} · ${item.status}`
            }))}
          />
          {task && (
            <>
              <div className="monitor-strip">
                <Space wrap>
                  <Tag
                    color={active ? 'processing' : task.status === 'failed' ? 'error' : 'default'}
                  >
                    {active ? '监控中' : task.status === 'failed' ? '异常结束' : '已停止'}
                  </Tag>
                  <span>
                    累计 {task.total} · 保留 {task.events.length} · 截断 {task.truncated}
                  </span>
                </Space>
                {(active || task.canStop) && (
                  <Tooltip title="停止监控">
                    <Button
                      danger
                      aria-label="停止监控"
                      icon={<Square size={16} />}
                      disabled={busy}
                      onClick={() => void run('crash.stop', { taskId: task.id })}
                    />
                  </Tooltip>
                )}
              </div>
              {task.reason && <p className="muted">{task.reason}</p>}
              <Table<CrashEvent>
                size="small"
                rowKey="id"
                dataSource={[...events].reverse()}
                pagination={{ pageSize: 15 }}
                scroll={{ x: 750 }}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'ts',
                    width: 110,
                    render: (value: number) => new Date(value).toLocaleTimeString()
                  },
                  {
                    title: '等级',
                    dataIndex: 'severity',
                    width: 90,
                    render: (value: string) => (
                      <Tag
                        color={
                          value === 'fatal' ? 'error' : value === 'error' ? 'warning' : 'default'
                        }
                      >
                        {value}
                      </Tag>
                    )
                  },
                  {
                    title: '包名',
                    dataIndex: 'bundleName',
                    width: 200,
                    render: (value: string) => <span className="path-text">{value || '未知'}</span>
                  },
                  {
                    title: '原始事件',
                    dataIndex: 'raw',
                    render: (value: string) => <span className="path-text">{value}</span>
                  }
                ]}
              />
              <div className="tool-controls" style={{ marginTop: 18 }}>
                <Input
                  style={{ maxWidth: 400 }}
                  value={directory}
                  onChange={(event) => setDirectory(event.target.value)}
                  placeholder="导出目录"
                />
                <Tooltip title="选择导出目录">
                  <Button
                    aria-label="选择导出目录"
                    icon={<FolderOpen size={16} />}
                    onClick={() =>
                      void window.api
                        .selectFolder()
                        .then((path) => {
                          if (path) setDirectory(path)
                        })
                        .catch(report)
                    }
                  />
                </Tooltip>
                <Button
                  icon={<Download size={16} />}
                  disabled={!directory || !task.events.length || busy}
                  onClick={() => void run('crash.export', { taskId: task.id, directory })}
                >
                  导出事件
                </Button>
                <Tooltip title="清空当前显示">
                  <Button
                    aria-label="清空当前显示"
                    icon={<Trash2 size={16} />}
                    onClick={() =>
                      setHiddenThrough((prior) => ({ ...prior, [task.id]: task.total }))
                    }
                  />
                </Tooltip>
              </div>
            </>
          )}
        </section>
        {lastResult && <Alert type="info" title={lastResult} />}
      </div>
    </div>
  )
}
