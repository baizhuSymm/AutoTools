import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { violations } from './helpers/architectureRules'

test('main process production modules respect the layered dependency boundary', async () => {
  const errors: string[] = []
  for (const name of await readdir('src/main', { recursive: true })) {
    if (!name.endsWith('.ts')) continue
    const path = 'src/main/' + name.replaceAll('\\', '/')
    errors.push(...violations(path, await readFile(path, 'utf8')))
  }
  assert.deepEqual(errors, [])
})
