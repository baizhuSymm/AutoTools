import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { AgentRuntime, summarizeResult, type ModelAdapter } from '../src/main/agent/runtime'
import { JsonStore } from '../src/main/storage/store'
import { ToolExecutor, type ToolDefinition } from '../src/main/tools/executor'

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-recovery-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
const vault = { encrypt: () => null, decrypt: () => '' }
test('multibyte tool summaries respect the byte limit and retain pagination', () => {
  const content = summarizeResult({
    status: 'succeeded',
    summary: '中'.repeat(1000),
    data: {
      id: '中'.repeat(512),
      deviceId: '中'.repeat(512),
      bundleName: '中'.repeat(512),
      offset: 10,
      files: Array.from({ length: 30 }, (_, i) => ({
        id: `file-${i}`,
        name: '中'.repeat(200),
        size: 1
      }))
    }
  })
  assert.ok(Buffer.byteLength(content) <= 8192)
  const result = JSON.parse(content)
  assert.equal(result.data.nextOffset, 10 + result.data.files.length)
  assert.equal(result.data.files[0].id, 'file-0')
})
const noCalls: ModelAdapter = {
  async *stream() {
    yield { type: 'text', text: 'done' }
  }
}
const definition = (execute: ToolDefinition['execute']): ToolDefinition => ({
  name: 'read',
  description: 'read',
  schema: z.object({}),
  confirm: false,
  prepare: async () => ({ title: 'Read', data: {}, details: {} }),
  execute
})

test('shutdown waits for manual operation cleanup and persists its actual result', async () =>
  fixture(async (dir) => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let completed = false
    const executor = new ToolExecutor([
      definition(async (_, signal) => {
        started()
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => setTimeout(resolve, 30), { once: true })
        )
        completed = true
        return { status: 'partial', summary: 'cleanup complete' }
      })
    ])
    const store = new JsonStore(join(dir, 'state.json'))
    const runtime = new AgentRuntime(
      store,
      executor,
      () => noCalls,
      vault,
      () => {}
    )
    await runtime.init()
    const operation = runtime.execute('read', {})
    await ready
    await runtime.shutdown()
    assert.equal(completed, true)
    await operation
    const state = JSON.parse(await readFile(store.path, 'utf8'))
    assert.equal(state.calls[0].result.summary, 'cleanup complete')
  }))

for (const invalid of [
  null,
  {
    version: 1,
    conversations: [{ messages: [{ content: 'old' }] }],
    history: {},
    tasks: [],
    config: {}
  }
]) {
  test(`invalid persisted structure ${invalid === null ? 'null' : 'nested'} keeps original backup and loads defaults`, async () =>
    fixture(async (dir) => {
      const path = join(dir, 'state.json')
      const original = JSON.stringify(invalid)
      await writeFile(path, original)
      const runtime = new AgentRuntime(
        new JsonStore(path),
        new ToolExecutor([]),
        () => noCalls,
        vault,
        () => {}
      )
      await runtime.init()
      assert.equal(runtime.snapshot().conversations.length, 0)
      assert.ok(runtime.snapshot().warning)
      await runtime.createSession()
      const backup = (await readdir(dir)).find((name) => name.includes('.corrupt-'))!
      assert.equal(await readFile(join(dir, backup), 'utf8'), original)
    }))
}

test('deleting a conversation removes its global execution records', async () =>
  fixture(async (dir) => {
    let invoked = false
    const model: ModelAdapter = {
      async *stream() {
        if (!invoked) {
          invoked = true
          yield { type: 'calls', calls: [{ id: 'c', name: 'read', args: {} }] }
        } else yield { type: 'text', text: 'done' }
      }
    }
    const runtime = new AgentRuntime(
      new JsonStore(join(dir, 'state.json')),
      new ToolExecutor([definition(async () => ({ status: 'succeeded', summary: 'read' }))]),
      () => model,
      vault,
      () => {}
    )
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://example.com/v1', model: 'm', key: 'k' })
    runtime.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await runtime.createSession()
    await runtime.send(id, 'read')
    assert.equal(runtime.snapshot().calls.length, 1)
    await runtime.deleteSession(id)
    assert.equal(runtime.snapshot().calls.length, 0)
  }))

test('manual results survive a normal profile reload', async () =>
  fixture(async (dir) => {
    const executor = new ToolExecutor([
      definition(async () => ({ status: 'succeeded', summary: 'manual result' }))
    ])
    const store = new JsonStore(join(dir, 'state.json'))
    const runtime = new AgentRuntime(
      store,
      executor,
      () => noCalls,
      vault,
      () => {}
    )
    await runtime.init()
    await runtime.execute('read', {})
    const restored = new AgentRuntime(
      store,
      executor,
      () => noCalls,
      vault,
      () => {}
    )
    await restored.init()
    assert.equal(restored.snapshot().calls[0].result?.summary, 'manual result')
  }))

test('a connection test cannot grant capabilities to a different saved configuration', async () =>
  fixture(async (dir) => {
    const runtime = new AgentRuntime(
      new JsonStore(join(dir, 'state.json')),
      new ToolExecutor([]),
      () => noCalls,
      vault,
      () => {}
    )
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://a.example.com/v1', model: 'a', key: 'k' })
    let finish!: () => void
    const testResult = runtime.testConnection(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { text: true, streaming: true, tools: true }
    })
    await runtime.saveConfig({ baseURL: 'https://b.example.com/v1', model: 'b' })
    finish()
    await assert.rejects(testResult)
    assert.equal(runtime.snapshot().config.capabilities, undefined)
  }))

test('large scan summary preserves selectable file references', async () =>
  fixture(async (dir) => {
    let requests = 0
    let observed = false
    const model: ModelAdapter = {
      async *stream(messages) {
        if (++requests === 1) yield { type: 'calls', calls: [{ id: 'c', name: 'read', args: {} }] }
        else {
          const result = JSON.parse(messages.at(-1)!.content)
          assert.equal(result.data.files[0].id, 'file-0')
          assert.ok(Buffer.byteLength(messages.at(-1)!.content) <= 8192)
          observed = true
          yield { type: 'text', text: 'done' }
        }
      }
    }
    const runtime = new AgentRuntime(
      new JsonStore(join(dir, 'state.json')),
      new ToolExecutor([
        definition(async () => ({
          status: 'succeeded',
          summary: 'scanned',
          data: {
            id: 'scan-id',
            files: Array.from({ length: 100 }, (_, i) => ({
              id: `file-${i}`,
              name: 'x'.repeat(150),
              path: 'y'.repeat(200)
            }))
          }
        }))
      ]),
      () => model,
      vault,
      () => {}
    )
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://example.com/v1', model: 'm', key: 'k' })
    runtime.setCapabilities({ text: true, streaming: true, tools: true })
    await runtime.send(await runtime.createSession(), 'scan')
    assert.equal(observed, true)
  }))
