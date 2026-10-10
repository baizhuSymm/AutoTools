import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { ChatService } from '../src/main/services/chatService'
import { SessionService } from '../src/main/services/sessionService'
import { ModelConfigService } from '../src/main/services/modelConfigService'
import { ToolService } from '../src/main/services/toolService'
import { SessionRepository } from '../src/main/repositories/sessionRepository'
import { ConfigRepository } from '../src/main/repositories/configRepository'
import { ExecutionRepository } from '../src/main/repositories/executionRepository'
import { prepareStorage } from '../src/main/storage/migration'
import { PersistenceCoordinator } from '../src/main/storage/persistenceCoordinator'
import { ToolExecutor } from '../src/main/services/tools/executor'
import { AgentRunner } from '../src/main/agent/runner'
import { fileSettings } from './helpers/storageFixture'

test('deleting active approval cancels, waits and clears execution state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-service-'))
  const { database, settings } = await prepareStorage(dir, fileSettings)
  const persistence = new PersistenceCoordinator(database, () => {})
  const executions = new ExecutionRepository(database)
  const sessions = new SessionService(
    new SessionRepository(database),
    executions,
    persistence,
    () => {}
  )
  const config = new ModelConfigService(
    new ConfigRepository(settings),
    { encrypt: () => null, decrypt: () => '' },
    async () => ({ text: true, streaming: true, tools: true }),
    () => false,
    () => {}
  )
  let effects = 0
  const tools = new ToolService(
    new ToolExecutor([
      {
        name: 'write',
        description: '',
        confirm: true,
        schema: z.object({}),
        prepare: async () => ({ title: '', details: {}, data: {} }),
        execute: async () => {
          effects++
          return { status: 'succeeded', summary: '' }
        }
      }
    ]),
    executions,
    persistence,
    () => {}
  )
  const chat = new ChatService(
    sessions,
    config,
    tools,
    new AgentRunner(),
    () => ({
      async *stream() {
        yield { type: 'calls', calls: [{ id: 'c', name: 'write', args: {} }] }
      }
    }),
    persistence,
    () => {}
  )
  try {
    config.initialize()
    await config.save({ baseURL: 'https://example.com/v1', model: 'test', key: 'fake' })
    await config.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await sessions.create()
    const running = chat.send(id, 'write')
    while (!tools.calls()[0]?.confirmationId) await new Promise((resolve) => setTimeout(resolve, 1))
    const confirmation = tools.calls()[0].confirmationId!
    assert.throws(() => chat.send(id, 'duplicate'))
    await chat.deleteSession(id)
    await running
    assert.equal(chat.activeSessionId(), null)
    assert.equal(sessions.list().length, 0)
    assert.equal(effects, 0)
    assert.throws(() => tools.confirm(confirmation, true))
  } finally {
    await chat.close()
    await tools.close()
    persistence.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
