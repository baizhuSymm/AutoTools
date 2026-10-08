import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createModel } from '../src/main/agent/model'

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
      new AbortController().signal
    )) {
      /* Drain the real adapter. */
    }
    const assistant = outgoing.find((message) => message.role === 'assistant')!
    assert.equal(assistant.reasoning_content, 'Provider explanation')
    assert.deepEqual(assistant.tool_calls, [
      { id: 'c', type: 'function', function: { name: 'read', arguments: '{}' } }
    ])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
