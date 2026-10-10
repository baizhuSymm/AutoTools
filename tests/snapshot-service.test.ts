import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SnapshotService } from '../src/main/services/agent/snapshotService'

test('snapshots are detached and batched publishing stops after disposal', async () => {
  const conversation = { id: 's', title: 'old', messages: [], updatedAt: 1 }
  const published: unknown[] = []
  const service = new SnapshotService(
    {
      conversations: () => [conversation],
      calls: () => [],
      config: () => ({ baseURL: '', model: '', hasKey: false, keyPersistent: false }),
      activeSessionId: () => null,
      warning: () => undefined
    },
    (snapshot) => published.push(snapshot)
  )
  service.snapshot().conversations[0].title = 'wrong'
  assert.equal(conversation.title, 'old')
  service.changed()
  service.changed()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(published.length, 1)
  assert.equal(service.snapshot().sequence, 1)
  service.changed()
  service.dispose()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(published.length, 1)
})
