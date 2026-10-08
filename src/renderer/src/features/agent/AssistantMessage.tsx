import { Actions, Think } from '@ant-design/x'
import { Tooltip } from 'antd'
import { Brain, Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ChatMessage } from '../../../../shared/agent'
import { splitReasoning } from '../../../../shared/reasoning'
import MarkdownContent from './MarkdownContent'
import ToolExecutionTrail from './ToolExecutionTrail'

export default function AssistantMessage({
  message,
  active
}: {
  message: ChatMessage
  active: boolean
}) {
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined)
  const legacy = useMemo(
    () =>
      message.status === undefined && message.reasoning === undefined
        ? splitReasoning(message.content)
        : undefined,
    [message.content, message.reasoning, message.status]
  )
  const content = legacy?.content ?? message.content
  const reasoning = message.reasoning ?? legacy?.reasoning
  const thinking = active && message.reasoningStatus === 'streaming'
  const interrupted = message.reasoningStatus === 'interrupted' || Boolean(legacy?.open)
  const title = thinking ? '思考中' : interrupted ? '思考已中止' : '思考完成'
  return (
    <div className="assistant-message">
      {reasoning && (
        <Think
          className="answer-think"
          title={title}
          icon={<Brain size={16} />}
          loading={thinking}
          expanded={expanded ?? thinking}
          onExpand={setExpanded}
        >
          <MarkdownContent content={reasoning} streaming={thinking} />
        </Think>
      )}
      <ToolExecutionTrail calls={message.calls} />
      {content && <MarkdownContent content={content} streaming={active} />}
      {active && !content && !thinking && (
        <div className="answer-pending" role="status">
          {message.calls.length ? '等待执行结果…' : '正在响应…'}
        </div>
      )}
      {!active && (content || reasoning) && (
        <footer className="message-actions">
          {content && (
            <Tooltip title="复制答复">
              <span>
                <Actions.Copy
                  text={content}
                  icon={[<Copy key="copy" size={15} />, <Check key="copied" size={15} />]}
                />
              </span>
            </Tooltip>
          )}
          <span className="message-completion">
            {message.status === 'cancelled'
              ? '已停止'
              : message.status === 'failed'
                ? '响应失败'
                : '答复完成'}
          </span>
        </footer>
      )}
    </div>
  )
}
