import { useEffect, useState, type ReactNode } from 'react'
import { Alert, App, Button, Modal, Spin } from 'antd'
import type { AppSnapshot } from '../../../../shared/agent'
import { AgentContext } from './context'
import ApprovalPreview from './ApprovalPreview'

export default function AgentProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem('agent-session')
  )
  const [failure, setFailure] = useState('')
  const [confirming, setConfirming] = useState(false)
  const { message } = App.useApp()
  useEffect(() => {
    if (!window.api?.agent) return
    let mounted = true
    const accept = (value: AppSnapshot): void => {
      if (mounted)
        setSnapshot((prior) => (!prior || value.sequence >= prior.sequence ? value : prior))
    }
    const off = window.api.agent.onSnapshot(accept)
    void window.api.agent
      .snapshot()
      .then(accept)
      .catch((error: unknown) => {
        if (mounted) setFailure(String(error))
      })
    return () => {
      mounted = false
      off()
    }
  }, [])
  const report = (error: unknown): void => {
    void message.error(error instanceof Error ? error.message : String(error))
  }
  if (!window.api?.agent)
    return (
      <div className="boot-state">
        <Alert type="info" title="请在 AutoTools 桌面窗口中使用本地工具" />
      </div>
    )
  if (failure)
    return (
      <div className="boot-state">
        <Alert
          type="error"
          title="无法加载本地记录"
          description={failure}
          action={<Button onClick={() => location.reload()}>重试</Button>}
        />
      </div>
    )
  if (!snapshot)
    return (
      <div className="boot-state">
        <Spin />
      </div>
    )
  const selectedId = snapshot.conversations.some((item) => item.id === selected)
    ? selected
    : (snapshot.conversations[0]?.id ?? null)
  const pending = snapshot.calls.find((call) => call.status === 'awaiting_confirmation')
  const confirm = async (approved: boolean): Promise<void> => {
    if (!pending?.confirmationId) return
    setConfirming(true)
    try {
      await window.api.agent.confirm(pending.confirmationId, approved)
    } catch (error) {
      report(error)
    } finally {
      setConfirming(false)
    }
  }
  return (
    <AgentContext.Provider
      value={{
        snapshot,
        selectedId,
        report,
        select: (id) => {
          setSelected(id)
          localStorage.setItem('agent-session', id)
        }
      }}
    >
      {snapshot.warning && (
        <Alert className="storage-warning" type="warning" title={snapshot.warning} />
      )}
      {children}
      <Modal
        key={pending?.id ?? 'no-approval'}
        open={Boolean(pending)}
        title={pending?.title}
        closable={false}
        mask={{ closable: false }}
        width={720}
        footer={
          <>
            <Button disabled={confirming} onClick={() => void confirm(false)}>
              拒绝
            </Button>
            <Button type="primary" loading={confirming} onClick={() => void confirm(true)}>
              确认执行
            </Button>
          </>
        }
      >
        <div className="approval-meta">
          {pending?.scope === 'manual' ? '手动操作' : '对话工具调用'} · 尚未执行
        </div>
        <ApprovalPreview details={pending?.details} />
      </Modal>
    </AgentContext.Provider>
  )
}
