import { ThoughtChain } from '@ant-design/x'
import { Tag } from 'antd'
import { Check, CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import type { ToolCall } from '../../../../shared/agent'
import { ToolResultDetails } from './ToolResultView'

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

export default function ToolExecutionTrail({ calls }: { calls: ToolCall[] }) {
  if (!calls.length) return null
  return (
    <section className="execution-trail" aria-label="工具执行过程">
      <div className="execution-trail-label">
        执行过程 <span>{calls.length} 个步骤</span>
      </div>
      <ThoughtChain
        items={calls.map((call) => {
          const active = ['validating', 'executing', 'awaiting_confirmation'].includes(call.status)
          const error = call.status === 'failed' || call.status === 'partial'
          const aborted = call.status === 'rejected' || call.status === 'cancelled'
          const Icon =
            call.status === 'awaiting_confirmation'
              ? ShieldCheck
              : active
                ? LoaderCircle
                : error
                  ? CircleAlert
                  : aborted
                    ? X
                    : Check
          return {
            key: call.id,
            icon: (
              <Icon
                size={16}
                className={
                  active && call.status !== 'awaiting_confirmation' ? 'tool-spinning' : undefined
                }
              />
            ),
            status: active
              ? ('loading' as const)
              : error
                ? ('error' as const)
                : aborted
                  ? ('abort' as const)
                  : ('success' as const),
            title: (
              <span className="execution-step-title">
                <span>{call.title}</span>
                <Tag
                  color={
                    call.status === 'awaiting_confirmation'
                      ? 'warning'
                      : error
                        ? 'error'
                        : 'default'
                  }
                >
                  {labels[call.status]}
                </Tag>
              </span>
            ),
            description:
              call.result?.summary ??
              (call.status === 'awaiting_confirmation' ? '确认后才会执行' : undefined),
            collapsible: call.result?.data !== undefined,
            content:
              call.result?.data !== undefined ? (
                <ToolResultDetails data={call.result.data} />
              ) : undefined
          }
        })}
      />
    </section>
  )
}
