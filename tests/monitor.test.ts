import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { MonitorManager } from '../src/main/tasks/monitor'

test('unconfirmed process exit remains stoppable and cannot spawn a duplicate stream', async () => {
  const stream = new EventEmitter()
  let starts = 0
  let stops = 0
  const manager = new MonitorManager(
    () => {
      starts++
      return {
        id: 's',
        on: stream.on.bind(stream),
        off: stream.off.bind(stream),
        stop: async () => {
          stops++
        }
      }
    },
    () => {}
  )
  const task = manager.start('device', 'app')
  await manager.stop(task.id)
  assert.equal(manager.start('device', 'app').id, task.id)
  await manager.stop(task.id)
  await manager.shutdown()
  assert.equal(starts, 1)
  assert.equal(stops, 3)
})

test('monitor preserves chunk fragments, flushes final line and shares a running task', async () => {
  const stream = new EventEmitter()
  let starts = 0
  const manager = new MonitorManager(
    () => {
      starts++
      return {
        id: 'stream',
        on: stream.on.bind(stream),
        off: stream.off.bind(stream),
        stop: async () => {
          stream.emit('close', 0)
        }
      }
    },
    () => {}
  )
  const task = manager.start('device', 'com.example.app')
  assert.equal(manager.start('device', 'com.example.app').id, task.id)
  stream.emit('stdout', 'FAT')
  stream.emit('stdout', 'AL bundleName: com.example.app\nERROR final')
  assert.equal(manager.snapshot(task.id).events.length, 1)
  await manager.stop(task.id)
  assert.equal(manager.snapshot(task.id).events.length, 2)
  assert.equal(manager.snapshot(task.id).status, 'stopped')
  await manager.stop(task.id)
  assert.equal(starts, 1)
})

test('monitor bounds event history and fragment size while keeping cumulative count', () => {
  const stream = new EventEmitter()
  const manager = new MonitorManager(
    () => ({
      id: 's',
      on: stream.on.bind(stream),
      off: stream.off.bind(stream),
      stop: async () => {}
    }),
    () => {}
  )
  const task = manager.start('device', 'app')
  stream.emit('stdout', Array.from({ length: 510 }, (_, i) => `ERROR ${i}\n`).join(''))
  stream.emit('stdout', 'ERROR ' + 'x'.repeat(70000))
  stream.emit('close', 0)
  const snapshot = manager.snapshot(task.id)
  assert.equal(snapshot.events.length, 500)
  assert.equal(snapshot.total, 511)
  assert.ok(snapshot.truncated > 0)
  assert.ok(snapshot.events.at(-1)!.raw.length <= 16384)
})

test('process error produces a failed task rather than a running task', () => {
  const stream = new EventEmitter()
  const manager = new MonitorManager(
    () => ({
      id: 's',
      on: stream.on.bind(stream),
      off: stream.off.bind(stream),
      stop: async () => {}
    }),
    () => {}
  )
  const task = manager.start('d', 'a')
  stream.emit('error', new Error('disconnected'))
  stream.emit('close', 1)
  assert.equal(manager.snapshot(task.id).status, 'failed')
})
