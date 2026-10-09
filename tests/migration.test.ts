import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareStorage } from '../src/main/storage/migration'
import { fileSettings } from './helpers/storageFixture'

const legacy = {
  version: 1,
  conversations: [],
  history: {},
  calls: [],
  tasks: [],
  config: { baseURL: 'https://example.com/v1', model: 'test' },
  encryptedKey: 'ciphertext'
}
test('legacy migration keeps byte-identical backup and does not replay on reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migration-'))
  try {
    const raw = JSON.stringify(legacy)
    await writeFile(join(dir, 'agent-state.json'), raw)
    const result = await prepareStorage(dir, fileSettings)
    assert.equal(await readFile(join(dir, 'agent-state.json.pre-layering.bak'), 'utf8'), raw)
    assert.equal(result.settings.read().encryptedKey, 'ciphertext')
    result.database.update((data) =>
      data.conversations.push({ id: 'new', title: 'new', messages: [], updatedAt: 1 })
    )
    await result.database.commit()
    const next = await prepareStorage(dir, fileSettings)
    assert.equal(next.database.read().conversations[0].id, 'new')
    await unlink(join(dir, 'agent-data.json'))
    const damaged = await prepareStorage(dir, fileSettings)
    assert.ok(damaged.warnings.length)
    await assert.rejects(damaged.database.commit())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('interrupted migration retries only from identical backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migration-'))
  try {
    await writeFile(join(dir, 'agent-state.json'), JSON.stringify(legacy))
    const failed = await prepareStorage(dir, async () => {
      throw new Error('settings write failed')
    })
    assert.ok(failed.warnings.length)
    await assert.rejects(failed.database.commit())
    await writeFile(
      join(dir, 'agent-state.json'),
      JSON.stringify({ ...legacy, config: { baseURL: '', model: 'changed' } })
    )
    const changed = await prepareStorage(dir, fileSettings)
    assert.ok(changed.warnings.length)
    await assert.rejects(changed.database.commit())
    await writeFile(join(dir, 'agent-state.json'), JSON.stringify(legacy))
    const retried = await prepareStorage(dir, fileSettings)
    assert.equal(retried.settings.read().migration?.kind, 'legacy')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('invalid legacy structure is preserved and never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migration-'))
  try {
    await writeFile(join(dir, 'agent-state.json'), 'null')
    const result = await prepareStorage(dir, fileSettings)
    assert.ok(result.warnings.length)
    await assert.rejects(result.database.commit())
    assert.equal(await readFile(join(dir, 'agent-state.json'), 'utf8'), 'null')
    assert.equal(await readFile(join(dir, 'agent-state.json.pre-layering.bak'), 'utf8'), 'null')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
