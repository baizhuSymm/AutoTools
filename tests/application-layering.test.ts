import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApplication } from '../src/main/bootstrap/createApplication'
import { applicationPlatform } from './helpers/applicationPlatform'
import { fileSettings } from './helpers/storageFixture'
import type { AppSnapshot, ToolCall } from '../src/shared/agent'
import type { ModelAdapter } from '../src/main/contracts/agent'

test('application shares scan references between manual and chat but not another application', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'application-layering-'))
  let scanId = '',
    requests = 0
  const model: ModelAdapter = {
    async *stream(messages) {
      if (++requests === 1)
        yield { type: 'calls', calls: [{ id: 'c', name: 'video.results', args: { scanId } }] }
      else {
        const reply = JSON.parse(messages.findLast((message) => message.role === 'tool')!.content)
        assert.equal(reply.data.total, 1)
        yield { type: 'text', text: 'shared scan' }
      }
    }
  }
  const options = {
    ...applicationPlatform(),
    settingsFactory: fileSettings,
    vault: { encrypt: () => null, decrypt: () => '' },
    publish: () => {},
    modelFactory: () => model,
    probe: async () => ({ text: true, streaming: true, tools: true })
  }
  const a = await createApplication({ ...options, userData: join(dir, 'a') })
  const b = await createApplication({ ...options, userData: join(dir, 'b') })
  try {
    assert.equal(await a.services.workspace.selectFolder(), null)
    await mkdir(join(dir, 'source', 'item'), { recursive: true })
    await writeFile(join(dir, 'source', 'item', 'one.mp4'), 'video')
    const scanned = await a.services.tools.execute('video.scan', { sourceDir: join(dir, 'source') })
    scanId = (scanned.data as { id: string }).id
    assert.equal((await b.services.tools.execute('video.results', { scanId })).status, 'failed')
    await a.services.config.save({ baseURL: 'https://example.com', model: 'test', key: 'fake' })
    await a.services.config.setCapabilities({ text: true, streaming: true, tools: true })
    const id = await a.services.sessions.create()
    await a.services.chat.send(id, 'use manual scan')
    assert.equal(a.services.sessions.get(id)?.messages.at(-1)?.content, 'shared scan')
    assert.equal(a.services.tools.calls().find((call) => call.scope === id)?.status, 'succeeded')
  } finally {
    await a.shutdown()
    await b.shutdown()
    await rm(dir, { recursive: true, force: true })
  }
})

test('shutdown cancels approval once persists it and never restores its authority', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'application-approval-'))
  let ready!: (call: ToolCall) => void
  const approval = new Promise<ToolCall>((resolve) => {
    ready = resolve
  })
  const options = {
    ...applicationPlatform(),
    userData: dir,
    settingsFactory: fileSettings,
    vault: { encrypt: () => null, decrypt: () => '' },
    modelFactory: (): ModelAdapter => ({ async *stream() {} }),
    probe: async () => ({ text: true, streaming: true, tools: true }),
    publish: (snapshot: AppSnapshot) => {
      const call = snapshot.calls.find((call) => call.status === 'awaiting_confirmation')
      if (call) ready(call)
    }
  }
  const app = await createApplication(options)
  try {
    await mkdir(join(dir, 'source', 'item'), { recursive: true })
    await writeFile(join(dir, 'source', 'item', 'one.mp4'), 'video')
    const scanned = await app.services.tools.execute('video.scan', {
      sourceDir: join(dir, 'source')
    })
    const scanId = (scanned.data as { id: string }).id
    const moving = app.services.tools.execute('video.move', {
      scanId,
      targetDir: join(dir, 'target')
    })
    const call = await approval
    const closing = app.shutdown()
    assert.equal(app.shutdown(), closing)
    assert.equal((await moving).status, 'cancelled')
    await closing
    assert.equal(await readFile(join(dir, 'source', 'item', 'one.mp4'), 'utf8'), 'video')
    const restored = await createApplication(options)
    try {
      assert.equal(
        restored.services.tools.calls().find((item) => item.id === call.id)?.status,
        'cancelled'
      )
      assert.throws(() => restored.services.tools.confirm(call.confirmationId!, true), /失效/)
    } finally {
      await restored.shutdown()
    }
  } finally {
    await app.shutdown()
    await rm(dir, { recursive: true, force: true })
  }
})
