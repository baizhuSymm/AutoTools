import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDatabase } from '../src/main/adapters/storage/agentDatabase'
import { SessionRepository } from '../src/main/adapters/storage/repositories/sessionRepository'
import { ExecutionRepository } from '../src/main/adapters/storage/repositories/executionRepository'
import { ConfigRepository } from '../src/main/adapters/storage/repositories/configRepository'
import { SettingsStore, emptySettings } from '../src/main/adapters/storage/settingsStore'
import type { WireMessage } from '../src/main/contracts/agent'

test('repositories write explicit history and calls without hidden business trimming', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repo-policy-'))
  try {
    const db = await AgentDatabase.open(dir)
    const sessions = new SessionRepository(db)
    const turns = Array.from({ length: 21 }, (_, i): WireMessage[] => [
      { role: 'user', content: String(i) }
    ])
    sessions.setHistory('s', turns)
    assert.equal(sessions.history('s').length, 21)
    sessions.history('s')[0][0].content = 'tampered'
    assert.equal(sessions.history('s')[0][0].content, '0')
    const calls = new ExecutionRepository(db)
    for (let i = 0; i < 201; i++)
      calls.upsert({
        id: String(i),
        scope: 'manual',
        name: 'read',
        title: 'read',
        status: 'succeeded'
      })
    assert.equal(calls.calls().length, 201)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('config repository exposes credentials but hides and preserves migration metadata', async () => {
  let body: Record<string, unknown> = {
    ...emptySettings(),
    encryptedKey: 'cipher',
    migration: { kind: 'fresh' }
  }
  const store = await SettingsStore.open('', async () => ({
    get store() {
      return body
    },
    set store(value) {
      body = value
    }
  }))
  const repository = new ConfigRepository(store)
  assert.deepEqual(Object.keys(repository.readConfig()).sort(), ['config', 'encryptedKey'])
  assert.equal(
    repository.saveConfig({ baseURL: 'https://example.com', model: 'new' }, 'new-cipher'),
    undefined
  )
  assert.deepEqual(store.read().migration, { kind: 'fresh' })
  assert.equal(repository.readConfig().encryptedKey, 'new-cipher')
})

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
