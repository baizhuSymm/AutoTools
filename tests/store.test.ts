import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '../src/main/storage/store'

test('serialized saves preserve the latest snapshot and corruption keeps a backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-store-'))
  try {
    const store = new JsonStore(join(dir, 'state.json'))
    await Promise.all([
      store.save({ version: 1, value: 'first' }),
      store.save({ version: 1, value: 'last' })
    ])
    assert.equal((await store.load<{ value: string }>({ value: 'empty' })).value, 'last')
    await writeFile(join(dir, 'state.json'), 'broken')
    assert.equal((await store.load({ value: 'fallback' })).value, 'fallback')
    assert.ok(store.warning)
    assert.equal(await readFile(store.backupPath!, 'utf8'), 'broken')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
