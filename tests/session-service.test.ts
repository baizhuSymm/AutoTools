import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentDatabase } from '../src/main/adapters/storage/agentDatabase'
import { PersistenceCoordinator } from '../src/main/adapters/storage/persistenceCoordinator'
import { SessionRepository } from '../src/main/adapters/storage/repositories/sessionRepository'
import { ExecutionRepository } from '../src/main/adapters/storage/repositories/executionRepository'
import { SessionService } from '../src/main/services/agent/sessionService'
import { memoryRepositories } from './helpers/memoryRepositories'
import type { WireMessage } from '../src/main/contracts/agent'

test('session service clips complete history turns using a plain repository port', async () => {
  const { repository, executions } = memoryRepositories()
  const service = new SessionService(
    repository,
    executions,
    { commit: async () => {}, schedule: () => {} },
    () => {}
  )
  const id = await service.create()
  const turns = Array.from({ length: 21 }, (_, i): WireMessage[] => [
    { role: 'user', content: String(i) },
    { role: 'assistant', content: '', tool_calls: [{ id: String(i), name: 'read', args: {} }] },
    { role: 'tool', content: 'ok', tool_call_id: String(i) }
  ])
  for (const turn of turns) service.appendHistory(id, turn)
  assert.equal(repository.history(id).length, 20)
  assert.deepEqual(repository.history(id)[0], turns[1])
  assert.deepEqual(repository.history(id).at(-1), turns[20])
})

test('session service targets message IDs and deletes associated history and calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sessions-'))
  const db = await AgentDatabase.open(dir)
  const coordinator = new PersistenceCoordinator(db, () => {})
  try {
    const repo = new SessionRepository(db)
    const executions = new ExecutionRepository(db)
    const service = new SessionService(repo, executions, coordinator, () => {})
    const id = await service.create()
    const turn = service.beginTurn(id, 'hello')
    service.updateMessage(id, turn.messageId, (message) => {
      message.content = 'answer'
    })
    service.appendHistory(id, [{ role: 'user', content: 'hello' }])
    executions.upsert({ id: 'c', scope: id, name: 'read', title: 'read', status: 'succeeded' })
    assert.equal(service.get(id)?.messages[1].content, 'answer')
    assert.equal(repo.history(id).length, 1)
    await service.delete(id)
    assert.deepEqual(repo.history(id), [])
    assert.equal(executions.calls().length, 0)
  } finally {
    coordinator.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
