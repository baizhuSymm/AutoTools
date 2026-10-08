import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listInstalledBundles, getForegroundBundle } from '../src/main/services/hdcService'

test('aborting an application query prevents all fallback commands', async () => {
  const controller = new AbortController()
  let commands = 0
  const run = async (_args: string[], options: { signal?: AbortSignal }) => {
    commands++
    assert.equal(options.signal?.aborted, false)
    controller.abort()
    return { code: -1, stdout: '', stderr: 'cancelled' }
  }
  await assert.rejects(listInstalledBundles('device', controller.signal, run))
  assert.equal(commands, 1)
})

test('aborting foreground query prevents fallback and targets the chosen device', async () => {
  const controller = new AbortController()
  let commands = 0
  const run = async (args: string[]) => {
    commands++
    assert.deepEqual(args.slice(0, 2), ['-t', 'device'])
    controller.abort()
    return { code: -1, stdout: '', stderr: 'cancelled' }
  }
  await assert.rejects(getForegroundBundle('device', controller.signal, run))
  assert.equal(commands, 1)
})
