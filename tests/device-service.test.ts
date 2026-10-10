import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DeviceService } from '../src/main/services/deviceService'
import { fakeHdc, ok, failed } from './helpers/hdcFixture'

test('device service chooses ordered bundle fallbacks and preserves the selected device', async () => {
  const queries: string[] = []
  const devices = new DeviceService(
    fakeHdc({
      listTargets: async () => ok('chosen'),
      queryBundles: async (id, variant, signal) => {
        assert.equal(id, 'chosen')
        assert.equal(signal.aborted, false)
        queries.push(variant)
        return variant === 'bm-user' ? ok('BundleName: z.app\nBundleName: a.app') : failed()
      }
    })
  )
  assert.deepEqual(await devices.listApps('chosen', new AbortController().signal), [
    'a.app',
    'z.app'
  ])
  assert.deepEqual(queries, ['bm', 'pm', 'bm-user'])
})

test('device service prevents disconnected and invalid device operations', async () => {
  let queries = 0
  const devices = new DeviceService(
    fakeHdc({
      listTargets: async () => ok('other'),
      queryBundles: async () => {
        queries++
        return ok()
      }
    })
  )
  await assert.rejects(devices.listApps('chosen', new AbortController().signal), /设备已断开/)
  await assert.rejects(devices.listApps('chosen;rm', new AbortController().signal))
  assert.equal(queries, 0)
})

test('foreground fallback returns null for unknown output rather than inventing an app', async () => {
  const variants: string[] = []
  const devices = new DeviceService(
    fakeHdc({
      listTargets: async () => ok('chosen'),
      queryForeground: async (_id, variant) => {
        variants.push(variant)
        return ok('unrecognized output')
      }
    })
  )
  assert.equal(await devices.foregroundApp('chosen', new AbortController().signal), null)
  assert.deepEqual(variants, ['aa', 'window'])
})
