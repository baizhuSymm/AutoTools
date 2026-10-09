import { ReasoningSplitter } from '../../shared/reasoning'
import type { ToolResult } from '../../shared/agent'
import type { ToolDefinition } from '../tools/executor'
import type { ModelAdapter, ModelCall, WireMessage } from './contracts'
import { summarizeResult } from './toolSummary'

export interface RunnerInput {
  messages: WireMessage[]
  model: ModelAdapter
  definitions: ToolDefinition[]
  signal: AbortSignal
  execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
}
export type RunnerEvent =
  | { type: 'text' | 'reasoning'; text: string }
  | { type: 'reasoning-status'; status: 'streaming' | 'done' | 'interrupted' }
  | { type: 'finished'; status: 'completed' | 'cancelled' | 'failed'; turn: WireMessage[]; error?: unknown }

export class AgentRunner {
  async *run(input: RunnerInput): AsyncIterable<RunnerEvent> {
    const { model, definitions, signal, execute } = input
    const messages = structuredClone(input.messages)
    const turn: WireMessage[] = [structuredClone(messages.at(-1)!)]
    let count = 0
    let bytes = 0
    let splitter = new ReasoningSplitter()
    let thinking = false
    try {
      for (;;) {
        signal.throwIfAborted()
        if (Buffer.byteLength(JSON.stringify(messages)) > 62000) throw new Error('本回合结果过多，请开始新的请求')
        let calls: ModelCall[] = []
        let text = ''
        let reasoning = ''
        splitter = new ReasoningSplitter()
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)])
        for await (const event of model.stream(messages, definitions, requestSignal)) {
          requestSignal.throwIfAborted()
          if (event.type === 'calls') { calls = event.calls; continue }
          bytes += Buffer.byteLength(event.text)
          if (bytes > 131072) throw new Error('模型回复超过长度上限')
          if (event.type === 'reasoning') {
            reasoning += event.text
            thinking = true
            yield { type: 'reasoning-status', status: 'streaming' }
            yield event
          } else {
            text += event.text
            for (const part of splitter.feed(event.text)) {
              if (part.type === 'reasoning') { thinking = true; yield { type: 'reasoning-status', status: 'streaming' } }
              yield part
              if (part.type === 'text' && thinking && !splitter.open) { thinking = false; yield { type: 'reasoning-status', status: 'done' } }
            }
            if (splitter.seen) {
              thinking = splitter.open
              yield { type: 'reasoning-status', status: splitter.open ? 'streaming' : 'done' }
            }
          }
        }
        requestSignal.throwIfAborted()
        for (const part of splitter.feed('', true)) yield part
        if (splitter.open || thinking) yield { type: 'reasoning-status', status: splitter.open ? 'interrupted' : 'done' }
        thinking = false
        const assistant: WireMessage = { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}) }
        if (!calls.length) { turn.push(assistant); break }
        if (!definitions.length) throw new Error('此模型尚未通过工具调用测试，请在设置中测试连接')
        if (count + calls.length > 12) throw new Error('达到每回合 12 次工具调用上限，请拆分请求')
        if (new Set(calls.map((call) => call.id)).size !== calls.length || calls.some((call) => !call.id)) throw new Error('模型工具调用 ID 无效')
        assistant.tool_calls = calls
        messages.push(assistant)
        turn.push(assistant)
        let rejected = false
        for (const call of calls) {
          const result: ToolResult = rejected ? { status: 'cancelled', summary: '前序操作被拒绝，未执行后续调用' } : await execute(call.name, call.args)
          count++
          const response: WireMessage = { role: 'tool', content: summarizeResult(result), tool_call_id: call.id }
          messages.push(response)
          turn.push(response)
          if (result.status === 'rejected' || result.status === 'cancelled') rejected = true
        }
        if (rejected) { yield { type: 'text', text: '\n操作已拒绝或取消，未继续执行。' }; break }
        if (count >= 12) { yield { type: 'text', text: '\n已达到本回合工具调用上限。' }; break }
        if (text) yield { type: 'text', text: '\n' }
      }
      signal.throwIfAborted()
      yield { type: 'finished', status: 'completed', turn }
    } catch (error) {
      for (const part of splitter.feed('', true)) yield part
      if (thinking || splitter.open) yield { type: 'reasoning-status', status: 'interrupted' }
      yield { type: 'finished', status: signal.aborted ? 'cancelled' : 'failed', turn, error }
    }
  }
}
