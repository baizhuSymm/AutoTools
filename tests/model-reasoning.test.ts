import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createModel } from '../src/main/adapters/model/langchainAdapter'
import { z } from 'zod'
import type { ModelEvent } from '../src/main/contracts/agent'

test('provider reasoning survives tool continuation in the actual outbound request', async () => {
  let outgoing: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    outgoing = JSON.parse(raw).messages
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(
      'data: ' +
        JSON.stringify({
          id: 'r',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }
          ]
        }) +
        '\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address() as { port: number }
    const model = createModel(
      {
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        model: 'test',
        hasKey: true,
        keyPersistent: false
      },
      'fake'
    )
    for await (const _event of model.stream(
      [
        { role: 'user', content: 'read' },
        {
          role: 'assistant',
          content: '',
          reasoning: 'Provider explanation',
          tool_calls: [{ id: 'c', name: 'read', args: {} }]
        },
        { role: 'tool', content: 'result', tool_call_id: 'c' }
      ],
      [],
      new AbortController().signal,
      'business-supplied prompt'
    )) {
      /* Drain the real adapter. */
    }
    const assistant = outgoing.find((message) => message.role === 'assistant')!
    assert.equal(outgoing[0].content, 'business-supplied prompt')
    assert.equal(assistant.reasoning_content, 'Provider explanation')
    assert.deepEqual(assistant.tool_calls, [
      { id: 'c', type: 'function', function: { name: 'read', arguments: '{}' } }
    ])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('model requests snapshot credentials and map streaming protocol tool names', async () => {
  const outgoing: { authorization?: string; url?: string; model: string }[] = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    outgoing.push({
      authorization: request.headers.authorization,
      url: request.url,
      model: JSON.parse(raw).model
    })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(
      'data: ' +
        JSON.stringify({
          id: 'r',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'c',
                    type: 'function',
                    function: { name: 'video_scan', arguments: '{"sourceDir":"C:/videos"}' }
                  }
                ]
              },
              finish_reason: 'tool_calls'
            }
          ]
        }) +
        '\n\ndata: [DONE]\n\n'
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as { port: number }
    const config = {
      baseURL: `http://127.0.0.1:${port}/a`,
      model: 'model-a',
      hasKey: true,
      keyPersistent: false
    }
    const a = createModel(config, 'key-a')
    config.baseURL = `http://127.0.0.1:${port}/b`
    config.model = 'model-b'
    const b = createModel(config, 'key-b')
    const events: ModelEvent[] = []
    for (const model of [a, b]) {
      for await (const event of model.stream(
        [{ role: 'user', content: 'scan' }],
        [
          {
            name: 'video.scan',
            description: 'scan',
            confirm: false,
            schema: z.object({ sourceDir: z.string() }),
            prepare: async () => ({ title: '', data: {}, details: {} }),
            execute: async () => ({ status: 'succeeded', summary: '' })
          }
        ],
        new AbortController().signal,
        'prompt'
      ))
        events.push(event)
    }
    assert.deepEqual(outgoing, [
      { authorization: 'Bearer key-a', url: '/a/chat/completions', model: 'model-a' },
      { authorization: 'Bearer key-b', url: '/b/chat/completions', model: 'model-b' }
    ])
    assert.deepEqual(
      events.filter((event) => event.type === 'calls'),
      [
        {
          type: 'calls',
          calls: [{ id: 'c', name: 'video.scan', args: { sourceDir: 'C:/videos' } }]
        },
        {
          type: 'calls',
          calls: [{ id: 'c', name: 'video.scan', args: { sourceDir: 'C:/videos' } }]
        }
      ]
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
