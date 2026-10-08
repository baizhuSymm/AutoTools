import { Descriptions, Table } from 'antd'

export default function ApprovalPreview({ details }: { details: unknown }) {
  if (!details || typeof details !== 'object') return null
  const data = details as Record<string, unknown>
  if (Array.isArray(data.items)) {
    const items = data.items as {
      source: string
      destination: string
      fingerprint: { size: number }
    }[]
    return (
      <>
        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: 'target',
              label: '目标目录',
              children: <span className="path-text">{String(data.target)}</span>
            },
            { key: 'count', label: '文件数量', children: items.length },
            {
              key: 'effect',
              label: '操作',
              children: '复制完成后删除源文件；同名目标使用清单中显示的新名称。'
            }
          ]}
        />
        <Table
          size="small"
          rowKey="source"
          dataSource={items}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 500, y: 300 }}
          columns={[
            {
              title: '源文件',
              dataIndex: 'source',
              render: (value: string) => <span className="path-text">{value}</span>
            },
            {
              title: '实际目标',
              dataIndex: 'destination',
              render: (value: string) => <span className="path-text">{value}</span>
            },
            {
              title: '大小',
              width: 90,
              render: (_, item) => `${(item.fingerprint.size / 1048576).toFixed(1)} MB`
            }
          ]}
        />
      </>
    )
  }
  const names: Record<string, string> = {
    deviceId: '设备',
    port: '本机端口',
    socketName: '设备 socket',
    taskId: '任务',
    paths: '输出文件',
    total: '累计事件',
    retained: '导出事件',
    dropped: '已丢弃事件'
  }
  return (
    <Descriptions
      size="small"
      column={1}
      items={Object.entries(data).map(([key, value]) => ({
        key,
        label: names[key] ?? key,
        children: (
          <span className="path-text">
            {Array.isArray(value) ? value.map(String).join('\n') : String(value)}
          </span>
        )
      }))}
    />
  )
}
