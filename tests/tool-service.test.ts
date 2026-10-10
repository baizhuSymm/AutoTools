import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { AgentDatabase } from '../src/main/adapters/storage/agentDatabase'
import { ExecutionRepository } from '../src/main/adapters/storage/repositories/executionRepository'
import { PersistenceCoordinator } from '../src/main/adapters/storage/persistenceCoordinator'
import { ToolExecutor } from '../src/main/services/tools/executor'
import { ToolService } from '../src/main/services/tools/toolService'
import { memoryRepositories } from './helpers/memoryRepositories'

test('tool service prunes terminal records without deleting active approvals', async () => {
  for (const hasTerminal of [false, true]) {
    const { executions } = memoryRepositories()
    for (let i = 0; i < 200; i++)
      executions.upsert({
        id: String(i),
        scope: 'manual',
        name: 'read',
        title: 'read',
        status: hasTerminal && i === 0 ? 'succeeded' : 'awaiting_confirmation'
      })
    const service = new ToolService(
      new ToolExecutor([
        {
          name: 'read',
          description: '',
          schema: z.object({}),
          confirm: false,
          prepare: async () => ({ title: 'read', details: {}, data: {} }),
          execute: async () => ({ status: 'succeeded', summary: 'ok' })
        }
      ]),
      executions,
      { schedule: () => {}, commit: async () => {} },
      () => {}
    )
    assert.equal((await service.execute('read', {})).status, 'succeeded')
    assert.equal(executions.calls().length, 200)
    assert.equal(
      executions.calls().filter((call) => call.status === 'awaiting_confirmation').length,
      hasTerminal ? 199 : 200
    )
    assert.equal(
      executions.calls().some((call) => call.id === '0'),
      !hasTerminal
    )
    await service.close()
  }
})

test('unavailable persistence blocks manual tools before preparation or approval', async () => {
  const db = AgentDatabase.unavailable('migration blocked')
  const persistence = new PersistenceCoordinator(db, () => {})
  let preparations = 0
  let effects = 0
  const service = new ToolService(
    new ToolExecutor([
      {
        name: 'write',
        description: '',
        schema: z.object({}),
        confirm: true,
        prepare: async () => {
          preparations++
          return { title: 'write', details: {}, data: {} }
        },
        execute: async () => {
          effects++
          return { status: 'succeeded', summary: '' }
        }
      }
    ]),
    new ExecutionRepository(db),
    persistence,
    () => {}
  )
  const operation = service.execute('write', {})
  const rejected = assert.rejects(operation, /migration blocked/)
  await new Promise((resolve) => setTimeout(resolve, 10))
  for (const call of service.calls()) {
    if (call.confirmationId) service.confirm(call.confirmationId, true)
  }
  await rejected
  assert.equal(preparations, 0)
  assert.equal(effects, 0)
  assert.deepEqual(service.calls(), [])
  await service.close()
  persistence.dispose()
})

test('tool service shares execution records and preserves single-use approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tools-'))
  const db = await AgentDatabase.open(dir)
  const persistence = new PersistenceCoordinator(db, () => {})
  let effects = 0
  const repo = new ExecutionRepository(db)
  const executor = new ToolExecutor([
    {
      name: 'write',
      description: '',
      schema: z.object({ value: z.number() }),
      confirm: true,
      prepare: async (input) => ({ title: 'write', details: input, data: input }),
      execute: async (input) => {
        effects++
        assert.deepEqual(input, { value: 1 })
        return { status: 'succeeded', summary: 'written' }
      }
    }
  ])
  const service = new ToolService(executor, repo, persistence, () => {})
  try {
    const operation = service.execute('write', { value: 1 })
    while (!service.calls()[0]?.confirmationId)
      await new Promise((resolve) => setTimeout(resolve, 1))
    const id = service.calls()[0].confirmationId!
    service.confirm(id, true)
    await operation
    assert.equal(effects, 1)
    assert.throws(() => service.confirm(id, true))
    assert.equal((await AgentDatabase.open(dir)).read().calls[0].result?.status, 'succeeded')
    await service.close()
    await assert.rejects(service.execute('write', { value: 1 }))
  } finally {
    persistence.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
