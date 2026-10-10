import { applicationPlatform } from './helpers/applicationPlatform'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApplication } from '../src/main/bootstrap/createApplication'
import { fileSettings } from './helpers/storageFixture'
import { AgentDatabase } from '../src/main/adapters/storage/agentDatabase'
import { ToolExecutor } from '../src/main/services/tools/executor'
import { z } from 'zod'

test('a final disk failure marks the answer failed without replaying tool effects', async (context) => {
  const dir = await mkdtemp(join(tmpdir(), 'disk-failure-'))
  let writes = 0
  const originalCommit = AgentDatabase.prototype.commit
  context.mock.method(AgentDatabase.prototype, 'commit', function (this: AgentDatabase) {
    if (++writes === 4) return Promise.reject(new Error('disk full'))
    return originalCommit.call(this)
  })
  let effects = 0
  let requests = 0
  const app = await createApplication({
    ...applicationPlatform(),
    userData: dir,
    settingsFactory: fileSettings,
    vault: { encrypt: () => null, decrypt: () => '' },
    publish: () => {},
    probe: async () => ({ text: true, streaming: true, tools: true }),
    modelFactory: () => ({
      async *stream() {
        if (++requests === 1) yield { type: 'calls', calls: [{ id: 'c', name: 'write', args: {} }] }
        else yield { type: 'text', text: 'done' }
      }
    }),
    executor: new ToolExecutor([
      {
        name: 'write',
        description: '',
        schema: z.object({}),
        confirm: false,
        prepare: async () => ({ title: '', data: {}, details: {} }),
        execute: async () => {
          effects++
          return { status: 'succeeded', summary: 'effect done' }
        }
      }
    ])
  })
  try {
    await app.services.config.save({ baseURL: 'https://example.com', model: 'test', key: 'fake' })
    await app.services.config.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await app.services.sessions.create()
    await assert.rejects(app.services.chat.send(id, 'write'), /disk full/)
    assert.equal(effects, 1)
    assert.equal(app.services.chat.activeSessionId(), null)
    assert.equal(app.services.sessions.get(id)?.messages.at(-1)?.status, 'failed')
    await assert.rejects(app.shutdown(), /disk full/)
    assert.equal(effects, 1)
    assert.equal(
      (await AgentDatabase.open(dir)).read().conversations[0].messages.at(-1)?.status,
      'failed'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('application composition persists sessions and drains shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'application-'))
  try {
    const options = {
      ...applicationPlatform(),
      userData: dir,
      vault: { encrypt: () => null, decrypt: () => '' },
      modelFactory: () => ({
        async *stream() {
          yield { type: 'text' as const, text: 'done' }
        }
      }),
      probe: async () => ({ text: true, streaming: true, tools: true }),
      publish: () => {},
      settingsFactory: fileSettings
    }
    const app = await createApplication(options)
    await app.services.config.save({
      baseURL: 'https://example.com/v1',
      model: 'test',
      key: 'fake'
    })
    const id = await app.services.sessions.create()
    await app.services.chat.send(id, 'hello')
    assert.equal(
      app.services.snapshots.snapshot().conversations[0].messages.at(-1)?.content,
      'done'
    )
    await app.shutdown()
    const restored = await createApplication(options)
    assert.equal(restored.services.sessions.list()[0].id, id)
    await restored.shutdown()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
