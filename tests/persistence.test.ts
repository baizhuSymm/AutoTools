import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PersistenceCoordinator } from '../src/main/storage/persistenceCoordinator'

test('flush reports unresolved write failure and successful retry clears it', async () => {
  let fail = true
  const coordinator = new PersistenceCoordinator({ commit: async () => { if (fail) throw new Error('disk full') }, flush: async () => {} }, () => {})
  await assert.rejects(coordinator.commit(), /disk full/)
  await assert.rejects(coordinator.flush(), /disk full/)
  fail = false
  await coordinator.commit()
  await coordinator.flush()
  coordinator.dispose()
})
