import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SettingsStore, emptySettings } from '../src/main/storage/settingsStore'
import { ConfigRepository } from '../src/main/repositories/configRepository'
import { ModelConfigService } from '../src/main/services/modelConfigService'

test('a resolved old probe cannot pair an old endpoint with a newly saved key', async () => {
  let body: Record<string, unknown> = emptySettings()
  const store = await SettingsStore.open('', async () => ({
    get store() {
      return body
    },
    set store(value) {
      body = value
    }
  }))
  let resolve!: (value: { text: boolean; streaming: boolean; tools: boolean }) => void
  const config = new ModelConfigService(
    new ConfigRepository(store),
    { encrypt: (key) => `cipher:${key}`, decrypt: (key) => key },
    () =>
      new Promise((done) => {
        resolve = done
      }),
    () => false,
    () => {}
  )
  config.initialize()
  await config.save({ baseURL: 'https://old.example.com', model: 'old', key: 'old-key' })
  const testing = config.testConnection()
  resolve({ text: true, streaming: true, tools: true })
  const saving = config.save({ baseURL: 'https://new.example.com', model: 'new', key: 'new-key' })
  const [tested] = await Promise.allSettled([testing, saving])
  assert.equal(tested.status, 'rejected')
  assert.equal(store.read().config.baseURL, 'https://new.example.com')
  assert.equal(store.read().encryptedKey, 'cipher:new-key')
  assert.equal(config.snapshot().baseURL, store.read().config.baseURL)
  assert.equal(config.snapshot().capabilities, undefined)
  assert.equal(store.read().config.capabilities, undefined)
})

test('failed config writes do not publish success and failed decryption never claims a key', async () => {
  const data = { ...emptySettings(), encryptedKey: 'ciphertext' }
  const store = await SettingsStore.open('', async () => ({
    get store() {
      return { ...data }
    },
    set store(_value) {
      throw new Error('disk full')
    }
  }))
  let publications = 0
  const config = new ModelConfigService(
    new ConfigRepository(store),
    {
      encrypt: () => null,
      decrypt: () => {
        throw new Error('unavailable')
      }
    },
    async () => ({ text: true, streaming: true, tools: true }),
    () => false,
    () => {
      publications++
    }
  )
  config.initialize()
  assert.equal(config.snapshot().hasKey, false)
  assert.equal(config.snapshot().keyPersistent, false)
  assert.ok(config.warning)
  await assert.rejects(
    config.save({ baseURL: 'https://example.com', model: 'test', key: 'fake' }),
    /disk full/
  )
  assert.equal(config.snapshot().hasKey, false)
  assert.equal(publications, 0)
})

test('configuration keeps plaintext out of snapshots and disk and respects busy/revision guards', async () => {
  let body: Record<string, unknown> = { ...emptySettings(), migration: { kind: 'fresh' } }
  const store = await SettingsStore.open('', async () => ({
    get store() {
      return body
    },
    set store(value) {
      body = value
    }
  }))
  let busy = false
  let resolve!: (value: { text: boolean; streaming: boolean; tools: boolean }) => void
  const config = new ModelConfigService(
    new ConfigRepository(store),
    { encrypt: () => null, decrypt: () => '' },
    async () =>
      new Promise((done) => {
        resolve = done
      }),
    () => busy,
    () => {}
  )
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
