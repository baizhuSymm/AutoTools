import type { AgentData } from './schema'

// 恢复记录，不恢复审批权限或真实进程。
export function recoverAgentData(input: AgentData): AgentData {
  const state = structuredClone(input)
  for (const message of state.conversations.flatMap((session) => session.messages)) {
    if (message.status === 'streaming') message.status = 'cancelled'
    if (message.reasoningStatus === 'streaming') message.reasoningStatus = 'interrupted'
  }
  for (const call of [
    ...state.calls,
    ...state.conversations.flatMap((session) =>
      session.messages.flatMap((message) => message.calls)
    )
  ]) {
    delete call.confirmationId
    if (['validating', 'executing', 'awaiting_confirmation'].includes(call.status)) {
      call.status = 'cancelled'
      call.result = { status: 'cancelled', summary: '上次运行已中断，未恢复执行' }
    }
  }
  return state
}
