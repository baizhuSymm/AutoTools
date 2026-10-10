import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ToolExecutor } from '../src/main/tools/executor'

test('pending mutation approval does not block read-only tools', async () => {
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({}),
      confirm: true,
      prepare: async () => ({ title: 'Write', details: {}, data: {} }),
      execute: async () => ({ status: 'succeeded', summary: 'written' })
    },
    {
      name: 'read',
      description: 'read',
      schema: z.object({}),
      confirm: false,
      prepare: async () => ({ title: 'Read', details: {}, data: {} }),
      execute: async () => ({ status: 'succeeded', summary: 'read' })
    }
  ])
  const controller = new AbortController()
  const context = { scope: 'test', signal: controller.signal, update: () => {} }
  const pending = executor.execute('write', {}, context)
  try {
    await new Promise((resolve) => setImmediate(resolve))
    const outcome = await Promise.race([
      executor.execute('read', {}, context),
      new Promise<{ status: string }>((resolve) =>
        setTimeout(() => resolve({ status: 'blocked' }), 30)
      )
    ])
    assert.equal(outcome.status, 'succeeded')
  } finally {
    controller.abort()
    await pending
  }
})

test('mutation waits for a single-use approval and executes the original prepared input', async () => {
  let effects = 0
  let approvalId = ''
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({ path: z.string() }),
      confirm: true,
      prepare: async (input) => ({ title: 'Write', details: input, data: { ...input } }),
      execute: async (plan) => {
        effects++
        return { status: 'succeeded', data: plan, summary: 'done' }
      }
    }
  ])
  const input = { path: 'original' }
  const pending = executor.execute('write', input, {
    scope: 'test',
    signal: new AbortController().signal,
    update: (call) => {
      approvalId = call.confirmationId ?? approvalId
    }
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(effects, 0)
  input.path = 'replacement'
  executor.confirm(approvalId, true)
  assert.throws(() => executor.confirm(approvalId, true))
  assert.deepEqual((await pending).data, { path: 'original' })
  assert.equal(effects, 1)
})

test('cancelled pending approval never executes and cannot be approved later', async () => {
  let effects = 0
  let id = ''
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({}),
      confirm: true,
      prepare: async () => ({ title: 'Write', details: {}, data: {} }),
      execute: async () => {
        effects++
        return { status: 'succeeded', summary: 'done' }
      }
    }
  ])
  const controller = new AbortController()
  const pending = executor.execute(
    'write',
    {},
    {
      scope: 'test',
      signal: controller.signal,
      update: (call) => {
        id = call.confirmationId ?? id
      }
    }
  )
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  assert.equal((await pending).status, 'cancelled')
  assert.throws(() => executor.confirm(id, true))
  assert.equal(effects, 0)
})

test('invalid parameters and rejected approval do not cause side effects', async () => {
  let effects = 0
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: 'write',
      schema: z.object({ value: z.number() }),
      confirm: true,
      prepare: async (input) => ({ title: 'Write', details: input, data: input }),
      execute: async () => {
        effects++
        return { status: 'succeeded', summary: 'done' }
      }
    }
  ])
  const context = {
    scope: 'test',
    signal: new AbortController().signal,
    update: (call: { confirmationId?: string }) => {
      if (call.confirmationId) executor.confirm(call.confirmationId, false)
    }
  }
  assert.equal((await executor.execute('write', { value: 'bad' }, context)).status, 'failed')
  assert.equal((await executor.execute('write', { value: 1 }, context)).status, 'rejected')
  assert.equal(effects, 0)
})
