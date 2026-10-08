import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import {
  AgentRuntime,
  boundedHistory,
  type ModelAdapter,
  type WireMessage
} from '../src/main/agent/runtime'
import { JsonStore } from '../src/main/storage/store'
import { ToolExecutor } from '../src/main/tools/executor'

test('fake model requests flow through actual approval executor and persist a completed turn', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-runtime-'))
  let effects = 0
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({ path: z.string() }),
      confirm: true,
      prepare: async (input) => ({ title: 'Write', details: input, data: input }),
      execute: async () => {
        effects++
        return { status: 'succeeded', summary: 'written' }
      }
    }
  ])
  let steps = 0
  const model: ModelAdapter = {
    async *stream() {
      if (++steps === 1)
        yield { type: 'calls', calls: [{ id: 'c', name: 'write', args: { path: 'file' } }] }
      else yield { type: 'text', text: 'completed' }
    }
  }
  const runtime = new AgentRuntime(
    new JsonStore(join(dir, 'state.json')),
    executor,
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://example.com/v1', model: 'model', key: 'secret' })
    runtime.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await runtime.createSession()
    const running = runtime.send(id, 'write')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(effects, 0)
    assert.throws(() => runtime.send(id, 'duplicate'))
    const call = runtime.snapshot().calls.find((item) => item.confirmationId)!
    runtime.confirm(call.confirmationId!, true)
    await running
    assert.equal(effects, 1)
    assert.equal(runtime.snapshot().conversations[0].messages.at(-1)?.content, 'completed')
    assert.equal(runtime.snapshot().activeSessionId, null)
    const persisted = await new JsonStore(join(dir, 'state.json')).load<Record<string, unknown>>({})
    assert.ok(!JSON.stringify(persisted).includes('secret'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('history budget keeps complete user/model/tool groups without orphan tool results', () => {
  const turns: WireMessage[][] = Array.from({ length: 30 }, (_, i) => [
    { role: 'user', content: String(i) },
    { role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, name: 'read', args: {} }] },
    { role: 'tool', content: 'x'.repeat(4000), tool_call_id: `c${i}` }
  ])
  const history = boundedHistory(turns, 'current')
  assert.ok(Buffer.byteLength(JSON.stringify(history)) <= 65536)
  assert.equal(history[0].role, 'user')
  assert.equal(history.at(-1)?.content, 'current')
  assert.throws(() => boundedHistory([], 'x'.repeat(66000)))
})

test('malformed model tool args cannot execute mutations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-runtime-'))
  let effects = 0
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({ value: z.number() }),
      confirm: false,
      prepare: async (input) => ({ title: 'Write', data: input, details: input }),
      execute: async () => {
        effects++
        return { status: 'succeeded', summary: 'bad' }
      }
    }
  ])
  const model: ModelAdapter = {
    async *stream() {
      yield { type: 'calls', calls: [{ id: 'c', name: 'write', args: { value: 'invalid' } }] }
    }
  }
  const runtime = new AgentRuntime(
    new JsonStore(join(dir, 'state.json')),
    executor,
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://example.com/v1', model: 'm', key: 'k' })
    runtime.setCapabilities({ text: true, streaming: true, tools: true })
    await runtime.send(await runtime.createSession(), 'run')
    assert.equal(effects, 0)
    assert.ok(runtime.snapshot().calls.length <= 12)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
