import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SettingsStore, emptySettings } from '../src/main/storage/settingsStore'
import { ConfigRepository } from '../src/main/repositories/configRepository'
import { ModelConfigService } from '../src/main/services/modelConfigService'

test('configuration keeps plaintext out of snapshots and disk and respects busy/revision guards', async () => {
  let body: Record<string, unknown> = { ...emptySettings(), migration: { kind: 'fresh' } }
  const store = await SettingsStore.open('', async () => ({ get store() { return body }, set store(value) { body = value } }))
  let busy = false
  let resolve!: (value: { text: boolean; streaming: boolean; tools: boolean }) => void
  const config = new ModelConfigService(new ConfigRepository(store), { encrypt: () => null, decrypt: () => '' }, async () => new Promise((done) => { resolve = done }), () => busy, () => {})
  config.initialize()
  await config.save({ baseURL: 'https://example.com/v1/', model: 'test', key: ' fake-secret ' })
  assert.equal(config.snapshot().hasKey, true)
  assert.equal(config.snapshot().keyPersistent, false)
  assert.equal(JSON.stringify(body).includes('fake-secret'), false)
  assert.equal(JSON.stringify(config.snapshot()).includes('fake-secret'), false)
  assert.equal(store.read().migration?.kind, 'fresh')
  const pending = config.testConnection()
  await config.save({ baseURL: 'https://example.com/v1', model: 'changed' })
  resolve({ text: true, streaming: true, tools: true })
  await assert.rejects(pending, /配置已变化/)
  busy = true
  await assert.rejects(config.save({ baseURL: 'https://example.com', model: 'test' }))
  busy = false
  await assert.rejects(config.save({ baseURL: 'https://user:pass@example.com', model: 'test' }))
  assert.equal(config.sanitize(new Error('fake-secret leaked')), '[REDACTED] leaked')
})
