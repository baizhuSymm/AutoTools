import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentDatabase } from '../src/main/storage/agentDatabase'
import { PersistenceCoordinator } from '../src/main/storage/persistenceCoordinator'
import { SessionRepository } from '../src/main/repositories/sessionRepository'
import { ExecutionRepository } from '../src/main/repositories/executionRepository'
import { SessionService } from '../src/main/services/sessionService'

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
