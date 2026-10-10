import { ChatOpenAI } from '@langchain/openai'
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessageChunk
} from '@langchain/core/messages'
import { tool } from 'langchain'
import { z } from 'zod'
import type { ModelConfig } from '../../../shared/agent'
import type { ModelAdapter, ModelEvent, WireMessage } from '../../contracts/agent'
import type { ToolDefinition } from '../../contracts/agent'

function messages(
  input: WireMessage[],
  systemPrompt: string
): (HumanMessage | AIMessage | ToolMessage | SystemMessage)[] {
  return [
    new SystemMessage(systemPrompt),
    ...input.map((message) => {
      if (message.role === 'user') return new HumanMessage(message.content)
      if (message.role === 'tool')
        return new ToolMessage({ content: message.content, tool_call_id: message.tool_call_id! })
      return new AIMessage({
        content: message.content,
        additional_kwargs: message.reasoning ? { reasoning_content: message.reasoning } : {},
        tool_calls: message.tool_calls?.map((call) => ({
          ...call,
          name: call.name.replaceAll('.', '_'),
          type: 'tool_call' as const
        }))
      })
    })
  ]
}

export function createModel(inputConfig: ModelConfig, key: string): ModelAdapter {
  const config = structuredClone(inputConfig)
  return {
    async *stream(input, definitions, signal, systemPrompt): AsyncIterable<ModelEvent> {
      const assistantMessages = input.filter((message) => message.role === 'assistant')
      const model = new ChatOpenAI({
        model: config.model,
        apiKey: key,
        configuration: {
          baseURL: config.baseURL,
          // LangChain omits provider-specific reasoning when serializing AIMessage.
          fetch: (url, init) => {
            if (typeof init?.body === 'string') {
              const body = JSON.parse(init.body)
              let assistantIndex = 0
              for (const message of body.messages ?? []) {
                if (message.role !== 'assistant') continue
                const source = assistantMessages[assistantIndex++]
                if (source?.reasoning !== undefined) message.reasoning_content = source.reasoning
              }
              return fetch(url, { ...init, body: JSON.stringify(body) })
            }
            return fetch(url, init)
          }
        },
        maxRetries: 0,
        timeout: 120000,
        streaming: true,
        streamUsage: false,
        useResponsesApi: false
      })
      const tools = definitions.map((definition) =>
        tool(async () => '', {
          name: definition.name.replaceAll('.', '_'),
          description: definition.description,
          schema: definition.schema
        })
      )
      const bound = tools.length ? model.bindTools(tools, { parallel_tool_calls: false }) : model
      let combined: AIMessageChunk | undefined
      for await (const chunk of await bound.stream(messages(input, systemPrompt), { signal })) {
        combined = combined ? combined.concat(chunk) : chunk
        const reasoning = chunk.additional_kwargs.reasoning_content
        if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning }
        if (typeof chunk.content === 'string' && chunk.content)
          yield { type: 'text', text: chunk.content }
        else if (Array.isArray(chunk.content)) {
          for (const block of chunk.content)
            if (block.type === 'text' && typeof block.text === 'string')
              yield { type: 'text', text: block.text }
            else if (block.type === 'reasoning' && typeof block.reasoning === 'string')
              yield { type: 'reasoning', text: block.reasoning }
        }
      }
      if (combined?.invalid_tool_calls?.length)
        throw new Error('模型返回的工具参数无法解析，未执行')
      if (combined?.tool_calls?.length)
        yield {
          type: 'calls',
          calls: combined.tool_calls.map((call) => {
            const name =
              definitions.find((definition) => definition.name.replaceAll('.', '_') === call.name)
                ?.name ?? call.name
            return { id: call.id ?? '', name, args: call.args }
          })
        }
    }
  }
}

export async function testModel(
  config: ModelConfig,
  key: string
): Promise<NonNullable<ModelConfig['capabilities']>> {
  const model = new ChatOpenAI({
    model: config.model,
    apiKey: key,
    configuration: { baseURL: config.baseURL },
    timeout: 30000,
    maxRetries: 0,
    useResponsesApi: false,
    streamUsage: false
  })
  const result = { text: false, streaming: false, tools: false }
  try {
    const response = await model.invoke('Reply with OK.', { signal: AbortSignal.timeout(30000) })
    result.text = Boolean(response.content)
  } catch {
    /* Report capabilities separately. */
  }
  try {
    for await (const chunk of await model.stream('Reply with OK.', {
      signal: AbortSignal.timeout(30000)
    })) {
      if (chunk.content) result.streaming = true
    }
  } catch {
    /* Report capabilities separately. */
  }
  try {
    const probe = tool(async ({ value }) => value, {
      name: 'connection_probe',
      description: 'Harmless connection test',
      schema: z.object({ value: z.literal('ok') })
    })
    const response = await model
      .bindTools([probe], { tool_choice: 'connection_probe' })
      .invoke('Call connection_probe with value ok.', { signal: AbortSignal.timeout(30000) })
    const call = response.tool_calls?.[0]
    result.tools = call?.name === 'connection_probe' && call.args.value === 'ok'
  } catch {
    /* No business tools are executed in a capability test. */
  }
  return result
}
