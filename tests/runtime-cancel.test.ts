import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { AgentRuntime, type ModelAdapter } from '../src/main/agent/runtime'
import { JsonStore } from '../src/main/storage/store'
import { ToolExecutor } from '../src/main/tools/executor'

test('rejecting a call stops later calls in the same model response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-reject-'))
  let reads = 0
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({}),
      confirm: true,
      prepare: async () => ({ title: 'write', data: {}, details: {} }),
      execute: async () => ({ status: 'succeeded', summary: 'written' })
    },
    {
      name: 'read',
      description: 'read',
      schema: z.object({}),
      confirm: false,
      prepare: async () => ({ title: 'read', data: {}, details: {} }),
      execute: async () => {
        reads++
        return { status: 'succeeded', summary: 'read' }
      }
    }
  ])
  const model: ModelAdapter = {
    async *stream() {
      yield {
        type: 'calls',
        calls: [
          { id: 'one', name: 'write', args: {} },
          { id: 'two', name: 'read', args: {} }
        ]
      }
    }
  }
  const runtime = new AgentRuntime(
    new JsonStore(join(directory, 'state.json')),
    executor,
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.init()
    await runtime.saveConfig({ baseURL: 'https://example.com/v1', model: 'm', key: 'k' })
    runtime.setCapabilities({ text: true, streaming: true, tools: true })
    const run = runtime.send(await runtime.createSession(), 'run')
    await new Promise((resolve) => setTimeout(resolve, 10))
    runtime.confirm(
      runtime.snapshot().calls.find((call) => call.confirmationId)!.confirmationId!,
      false
    )
    await run
    assert.equal(reads, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
