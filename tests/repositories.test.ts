import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/main/storage/agentDatabase'
import { SessionRepository } from '../src/main/repositories/sessionRepository'
import { ExecutionRepository } from '../src/main/repositories/executionRepository'

test('repositories share one database and return detached copies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repos-'))
  try {
    const db = await AgentDatabase.open(dir)
    const sessions = new SessionRepository(db)
    const calls = new ExecutionRepository(db)
    sessions.insert({ id: 's', title: 'original', messages: [], updatedAt: 1 })
    const first = db.commit()
    calls.upsert({ id: 'c', scope: 'manual', name: 'read', title: 'read', status: 'succeeded' })
    const second = db.commit()
    sessions.list()[0].title = 'wrong'
    await Promise.all([first, second])
    const disk = (await AgentDatabase.open(dir)).read()
    assert.equal(disk.conversations[0].title, 'original')
    assert.equal(disk.calls[0].id, 'c')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
