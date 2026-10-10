import { createTestAgent, testFiles } from './helpers/agentFixture'
import type { ModelAdapter, WireMessage } from '../src/main/contracts/agent'
import { boundedHistory } from '../src/main/services/agent/history'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'

import { ToolExecutor } from '../src/main/services/tools/executor'

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
  const runtime = await createTestAgent(
    testFiles(join(dir, 'agent-state.json')),
    executor,
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.services.config.save({
      baseURL: 'https://example.com/v1',
      model: 'model',
      key: 'secret'
    })
    await runtime.services.config.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await runtime.services.sessions.create()
    const running = runtime.services.chat.send(id, 'write')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(effects, 0)
    assert.throws(() => runtime.services.chat.send(id, 'duplicate'))
    const call = runtime.services.snapshots.snapshot().calls.find((item) => item.confirmationId)!
    runtime.services.tools.confirm(call.confirmationId!, true)
    await running
    assert.equal(effects, 1)
    assert.equal(
      runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)?.content,
      'completed'
    )
    assert.equal(runtime.services.snapshots.snapshot().activeSessionId, null)
    const persisted = await testFiles(join(dir, 'agent-state.json')).load<Record<string, unknown>>(
      {}
    )
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
  const runtime = await createTestAgent(
    testFiles(join(dir, 'agent-state.json')),
    executor,
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.services.config.save({ baseURL: 'https://example.com/v1', model: 'm', key: 'k' })
    await runtime.services.config.setCapabilities({ text: true, streaming: true, tools: true })
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'run')
    assert.equal(effects, 0)
    assert.ok(runtime.services.snapshots.snapshot().calls.length <= 12)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
