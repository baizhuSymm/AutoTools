import { useEffect, useRef, useState } from 'react'
import { Bubble, Sender } from '@ant-design/x'
import { Alert, Button, Tag, Tooltip } from 'antd'
import { Bot, FolderOpen, Square, User } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAgent } from '../features/agent/context'
import AssistantMessage from '../features/agent/AssistantMessage'

export default function ChatPage() {
  const { snapshot, selectedId, select, report } = useAgent()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const session = snapshot.conversations.find((item) => item.id === selectedId)
  const running = Boolean(snapshot.activeSessionId)
  useEffect(() => {
    const element = scroll.current
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 240)
      element.scrollTop = element.scrollHeight
  }, [snapshot.sequence])
  const submit = async (value: string): Promise<void> => {
    if (!value.trim() || running || sending) return
    setSending(true)
    try {
      const id = selectedId ?? (await window.api.agent.createSession())
      select(id)
      setText('')
      await window.api.agent.send(id, value)
    } catch (error) {
      setText(value)
      report(error)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="chat-page">
      <header className="page-header">
        <div>
          <h1>{session?.title ?? '新会话'}</h1>
          <span className="muted">{snapshot.config.model || '未配置模型'}</span>
        </div>
        <Tag color={running ? 'processing' : 'default'}>{running ? '执行中' : '就绪'}</Tag>
      </header>
      {!snapshot.config.hasKey && (
        <Alert type="info" title="尚未配置模型连接" action={<Link to="/settings">打开设置</Link>} />
      )}
      {snapshot.config.hasKey && !snapshot.config.capabilities?.tools && (
        <Alert
          type="warning"
          title="工具调用尚未通过连接测试"
          action={<Link to="/settings">测试连接</Link>}
        />
      )}
      <div className="message-scroll" ref={scroll}>
        {!session?.messages.length && (
          <div className="conversation-empty">
            <Bot size={40} strokeWidth={1.4} />
            <h2>AutoTools</h2>
          </div>
        )}
        <div className="message-column">
          {session?.messages.map((item) => (
            <div key={item.id} className={`message-row ${item.role}`}>
              <Bubble
                placement={item.role === 'user' ? 'end' : 'start'}
                variant={item.role === 'user' ? 'filled' : 'borderless'}
                avatar={item.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                header={
                  item.role === 'assistant' ? (
                    <span className="assistant-name">AutoTools</span>
                  ) : undefined
                }
                content={
                  item.role === 'user' ? (
                    item.content
                  ) : (
                    <AssistantMessage
                      message={item}
                      active={
                        snapshot.activeSessionId === selectedId &&
                        item.id === session.messages.at(-1)?.id
                      }
                    />
                  )
                }
                styles={{
                  content:
                    item.role === 'user'
                      ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
                      : { width: '100%', minWidth: 0 }
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <footer className="composer-area">
        {running && snapshot.activeSessionId !== selectedId && (
          <Alert
            type="info"
            title="另一个会话正在执行"
            action={<Button onClick={() => select(snapshot.activeSessionId!)}>查看</Button>}
          />
        )}
        <Sender
          value={text}
          onChange={setText}
          onSubmit={(value) => void submit(value)}
          loading={running || sending}
          onCancel={() => void window.api.agent.cancel().catch(report)}
          disabled={!snapshot.config.hasKey}
          placeholder="输入请求…"
          prefix={
            <Tooltip title="选择目录">
              <Button
                type="text"
                icon={<FolderOpen size={18} />}
                aria-label="选择目录"
                onClick={() => {
                  void window.api
                    .selectFolder()
                    .then((path) => {
                      if (path) setText((prior) => `${prior}${prior ? ' ' : ''}${path}`)
                    })
                    .catch(report)
                }}
              />
            </Tooltip>
          }
        />
        {running && (
          <Button
            className="cancel-text"
            type="text"
            size="small"
            icon={<Square size={12} />}
            onClick={() => void window.api.agent.cancel().catch(report)}
          >
            停止生成
          </Button>
        )}
      </footer>
    </div>
  )
}
