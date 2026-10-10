import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DeviceService } from '../src/main/services/deviceService'
import { WebviewService } from '../src/main/services/webviewService'
import { fakeHdc, ok, failed } from './helpers/hdcFixture'
import type { HdcPort } from '../src/main/contracts/ports'

const signal = () => new AbortController().signal
function setup(overrides: Partial<HdcPort>) {
  const opened: string[] = []
  const hdc = fakeHdc({ listTargets: async () => ok('chosen'), ...overrides })
  return {
    opened,
    service: new WebviewService(
      new DeviceService(hdc),
      hdc,
      {
        open: async (url) => {
          opened.push('chrome:' + url)
        }
      },
      {
        open: async (url) => {
          opened.push('default:' + url)
        }
      }
    )
  }
}

test('probe stops on socket failure and returns already completed processes', async () => {
  const steps: string[] = []
  const { service } = setup({
    queryProcesses: async () => {
      steps.push('processes')
      return ok('chromium process\nunrelated')
    },
    querySockets: async () => {
      steps.push('sockets')
      return failed('socket failure')
    },
    listForwards: async () => {
      steps.push('forwarded')
      return ok()
    }
  })
  const result = await service.probe('chosen', signal())
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.data, {
    completed: { processes: ['chromium process'] },
    failedStep: 'sockets'
  })
  assert.deepEqual(steps, ['processes', 'sockets'])
})

test('device disconnection between probe steps prevents the next native operation', async () => {
  let lists = 0,
    sockets = 0
  const { service } = setup({
    listTargets: async () => ok(++lists === 1 ? 'chosen' : ''),
    queryProcesses: async () => ok('webview'),
    querySockets: async () => {
      sockets++
      return ok()
    }
  })
  const result = await service.probe('chosen', signal())
  assert.equal(result.status, 'failed')
  assert.match(result.summary, /设备已断开/)
  assert.deepEqual(result.data, { completed: { processes: ['webview'] }, failedStep: 'sockets' })
  assert.equal(sockets, 0)
})

test('probe cancellation retains completed steps without starting another command', async () => {
  const controller = new AbortController()
  let sockets = 0
  const { service } = setup({
    queryProcesses: async () => {
      controller.abort()
      return ok('webview')
    },
    querySockets: async () => {
      sockets++
      return ok()
    }
  })
  const result = await service.probe('chosen', controller.signal)
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(result.data, { completed: { processes: ['webview'] }, failedStep: 'sockets' })
  assert.equal(sockets, 0)
})

test('probe command exceptions preserve earlier results and identify the failed step', async () => {
  const { service } = setup({
    queryProcesses: async () => ok('webview'),
    querySockets: async () => {
      throw new Error('query transport failed')
    }
  })
  const result = await service.probe('chosen', signal())
  assert.equal(result.status, 'failed')
  assert.match(result.summary, /query transport failed/)
  assert.deepEqual(result.data, { completed: { processes: ['webview'] }, failedStep: 'sockets' })
})

test('forward-port conflict compares the whole port and normalizes the socket', async () => {
  let forwards = 'tcp:92221 localabstract:other',
    writes = 0
  const { service } = setup({
    listForwards: async () => ok(forwards),
    createForward: async (id, port, socket) => {
      assert.equal(id, 'chosen')
      assert.equal(port, 9222)
      assert.equal(socket, 'localabstract:test')
      writes++
      return ok()
    }
  })
  assert.equal((await service.forwardPort('chosen', 9222, 'test', signal())).status, 'succeeded')
  forwards = 'tcp:9222 localabstract:other'
  await assert.rejects(service.forwardPort('chosen', 9222, 'test', signal()), /已有转发/)
  await assert.rejects(service.forwardPort('chosen', 0, 'test', signal()))
  await assert.rejects(service.forwardPort('chosen', 9222, 'test;rm', signal()))
  assert.equal(writes, 1)
})

test('opening an endpoint requires an existing exact forward and checks cancellation', async () => {
  let forwards = 'tcp:92221 localabstract:test'
  const { service, opened } = setup({ listForwards: async () => ok(forwards) })
  await assert.rejects(service.openEndpoint('chosen', 9222, 'default', signal()), /未找到/)
  assert.deepEqual(opened, [])
  forwards = 'tcp:9222 localabstract:test'
  await service.openEndpoint('chosen', 9222, 'default', signal())
  await service.openEndpoint('chosen', 9222, 'chrome', signal())
  assert.deepEqual(opened, [
    'default:http://127.0.0.1:9222/json/list',
    'chrome:http://127.0.0.1:9222/json/list'
  ])
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(service.openEndpoint('chosen', 9222, 'default', controller.signal))
  assert.equal(opened.length, 2)
})

test('successful probe follows native step order and device mutations stay targeted', async () => {
  const operations: string[] = []
  const { service } = setup({
    queryProcesses: async () => {
      operations.push('processes')
      return ok('webview')
    },
    querySockets: async () => {
      operations.push('sockets')
      return ok('devtools')
    },
    listForwards: async () => {
      operations.push('forwarded')
      return ok('tcp:9222')
    },
    enableDebugging: async (id) => {
      operations.push('enable:' + id)
      return ok()
    },
    removeForward: async (id, port) => {
      operations.push(`remove:${id}:${port}`)
      return ok()
    }
  })
  assert.equal((await service.probe('chosen', signal())).status, 'succeeded')
  assert.equal((await service.enableDebugging('chosen', signal())).status, 'succeeded')
  assert.equal((await service.removeForward('chosen', 9222, signal())).status, 'succeeded')
  assert.deepEqual(operations, [
    'processes',
    'sockets',
    'forwarded',
    'enable:chosen',
    'remove:chosen:9222'
  ])
})
