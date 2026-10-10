import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { AgentRunner } from '../src/main/services/agent/runner'
import type { ModelAdapter } from '../src/main/contracts/agent'

test('request timeout and continuation budget fail without executing tools', async (context) => {
  context.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new Error('request timeout')))
  for (const content of ['hello', 'x'.repeat(62001)]) {
    let calls = 0
    const events = []
    const model: ModelAdapter = {
      async *stream() {
        yield { type: 'text', text: 'partial' }
      }
    }
    for await (const event of new AgentRunner().run({
      messages: [{ role: 'user', content }],
      model,
      definitions: [],
      signal: new AbortController().signal,
      execute: async () => {
        calls++
        return { status: 'succeeded', summary: '' }
      }
    }))
      events.push(event)
    const finished = events.at(-1)!
    assert.equal(finished.type, 'finished')
    if (finished.type === 'finished') assert.equal(finished.status, 'failed')
    assert.equal(calls, 0)
  }
})

const definitions = [
  {
    name: 'write',
    description: '',
    schema: z.object({}),
    confirm: true,
    prepare: async () => ({ title: '', details: {}, data: {} }),
    execute: async () => ({ status: 'succeeded' as const, summary: '' })
  }
]
test('abort or executor failure completes every declared tool reply without later execution', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let executions = 0
    const model: ModelAdapter = {
      async *stream() {
        yield {
          type: 'calls',
          calls: [
            { id: 'a', name: 'write', args: {} },
            { id: 'b', name: 'write', args: {} }
          ]
        }
      }
    }
    const events = []
    for await (const event of new AgentRunner().run({
      messages: [{ role: 'user', content: 'test' }],
      model,
      definitions,
      signal: controller.signal,
      execute: async () => {
        executions++
        if (abort && executions === 1) {
          controller.abort()
          return { status: 'partial', summary: 'cleanup finished' }
        }
        throw new Error('application closing')
      }
    }))
      events.push(event)
    const result = events.at(-1)!
    assert.equal(result.type, 'finished')
    if (result.type === 'finished') {
      assert.equal(result.status, abort ? 'cancelled' : 'failed')
      assert.deepEqual(
        result.turn
          .filter((message) => message.role === 'tool')
          .map((message) => message.tool_call_id),
        ['a', 'b']
      )
      assert.equal(JSON.parse(result.turn.at(-1)!.content).status, 'cancelled')
    }
    assert.equal(executions, 1)
  }
})
test('runner separates reasoning and stops after rejection without bypassing execution', async () => {
  const model: ModelAdapter = {
    async *stream() {
      yield { type: 'text', text: '<think>consider</think>answer' }
      yield {
        type: 'calls',
        calls: [
          { id: 'a', name: 'write', args: {} },
          { id: 'b', name: 'write', args: {} }
        ]
      }
    }
  }
  let effects = 0
  const events = []
  for await (const event of new AgentRunner().run({
    messages: [{ role: 'user', content: 'test' }],
    model,
    definitions,
    signal: new AbortController().signal,
    execute: async () => {
      effects++
      return { status: 'rejected', summary: 'no' }
    }
  }))
    events.push(event)
  assert.equal(effects, 1)
  assert.equal(
    events
      .filter((event) => event.type === 'reasoning')
      .map((event) => event.text)
      .join(''),
    'consider'
  )
  const result = events.find((event) => event.type === 'finished')!
  assert.equal(result.type, 'finished')
  if (result.type === 'finished') {
    assert.equal(result.status, 'completed')
    assert.equal(JSON.parse(result.turn.at(-1)!.content).status, 'cancelled')
  }
})

test('silent provider abort still ends as cancelled and unclosed thought remains interrupted', async () => {
  const controller = new AbortController()
  const model: ModelAdapter = {
    async *stream() {
      yield { type: 'text', text: '<think>partial' }
      controller.abort()
    }
  }
  const events = []
  for await (const event of new AgentRunner().run({
    messages: [{ role: 'user', content: 'test' }],
    model,
    definitions: [],
    signal: controller.signal,
    execute: async () => {
      throw new Error('must not execute')
    }
  }))
    events.push(event)
  assert.equal(events.at(-1)?.type, 'finished')
  const final = events.at(-1)!
  if (final.type === 'finished') assert.equal(final.status, 'cancelled')
  assert.ok(
    events.some((event) => event.type === 'reasoning-status' && event.status === 'interrupted')
  )
})

test('oversized reasoning and excess model tool calls fail before execution', async () => {
  for (const oversized of [true, false]) {
    let executions = 0
    const model: ModelAdapter = {
      async *stream() {
        if (oversized) yield { type: 'reasoning', text: 'x'.repeat(131073) }
        else
          yield {
            type: 'calls',
            calls: Array.from({ length: 13 }, (_, i) => ({
              id: String(i),
              name: 'write',
              args: {}
            }))
          }
      }
    }
    const events = []
    for await (const event of new AgentRunner().run({
      messages: [{ role: 'user', content: 'test' }],
      model,
      definitions,
      signal: new AbortController().signal,
      execute: async () => {
        executions++
        return { status: 'succeeded', summary: '' }
      }
    }))
      events.push(event)
    const final = events.at(-1)!
    if (final.type === 'finished') assert.equal(final.status, 'failed')
    assert.equal(executions, 0)
  }
})
