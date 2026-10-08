import { Collapse, Table, Tag } from 'antd'
import type { ToolCall } from '../../../../shared/agent'

const labels: Record<ToolCall['status'], string> = {
  validating: '校验中',
  awaiting_confirmation: '等待确认',
  executing: '执行中',
  succeeded: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  rejected: '已拒绝'
}

export default function ToolResultView({ call }: { call: ToolCall }) {
  const data = call.result?.data
  return (
    <div className="tool-result">
      <div className="tool-result-heading">
        <span>{call.title}</span>
        <Tag
          color={
            call.status === 'succeeded' ? 'success' : call.status === 'failed' ? 'error' : 'default'
          }
        >
          {labels[call.status]}
        </Tag>
      </div>
      {call.result && <p className="result-summary">{call.result.summary}</p>}
      {data !== undefined && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'result',
              label: '执行结果',
              children: <ToolResultDetails data={data} />
            }
          ]}
        />
      )}
    </div>
  )
}

export function ToolResultDetails({ data }: { data: unknown }) {
  const files =
    data && typeof data === 'object' && 'files' in data && Array.isArray(data.files)
      ? data.files
      : null
  return files ? (
    <Table
      size="small"
      rowKey="id"
      dataSource={files}
      pagination={{ pageSize: 10 }}
      scroll={{ x: 500 }}
      columns={[
        {
          title: '文件',
          dataIndex: 'name',
          render: (value: string) => <span className="path-text">{value}</span>
        },
        { title: '子目录', dataIndex: 'fromSubfolder' },
        {
          title: '大小',
          dataIndex: 'size',
          render: (value: number) => `${(value / 1048576).toFixed(1)} MB`
        }
      ]}
    />
  ) : (
    <pre className="structured-data">{JSON.stringify(data, null, 2)}</pre>
  )
}
