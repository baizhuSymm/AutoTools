import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DeviceService } from '../src/main/services/deviceService'
import { fakeHdc, ok, failed } from './helpers/hdcFixture'

test('aborting an application query prevents all fallback commands', async () => {
  const controller = new AbortController()
  let commands = 0
  const devices = new DeviceService(
    fakeHdc({
      listTargets: async () => ok('device'),
      queryBundles: async (_device, _variant, signal) => {
        commands++
        assert.equal(signal.aborted, false)
        controller.abort()
        return failed('cancelled')
      }
    })
  )
  await assert.rejects(devices.listApps('device', controller.signal))
  assert.equal(commands, 1)
})

test('aborting foreground query prevents fallback and targets the chosen device', async () => {
  const controller = new AbortController()
  let commands = 0
  const devices = new DeviceService(
    fakeHdc({
      listTargets: async () => ok('device'),
      queryForeground: async (device) => {
        commands++
        assert.equal(device, 'device')
        controller.abort()
        return failed('cancelled')
      }
    })
  )
  await assert.rejects(devices.foregroundApp('device', controller.signal))
  assert.equal(commands, 1)
})
