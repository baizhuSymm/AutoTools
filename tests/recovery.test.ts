import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recoverAgentData } from '../src/main/storage/recovery'
import { parseAgentData, parseSettings } from '../src/main/storage/schema'

test('recovery does not mutate source or restore approval authority', () => {
  const source = parseAgentData({ version: 1, conversations: [{ id: 's', title: 'test', updatedAt: 1, messages: [{ id: 'm', role: 'assistant', content: '', status: 'streaming', reasoningStatus: 'streaming', calls: [], createdAt: 1 }] }], history: {}, calls: [{ id: 'c', scope: 's', name: 'write', title: 'write', status: 'awaiting_confirmation', confirmationId: 'old' }], tasks: [{ id: 't', deviceId: 'd', bundleName: 'a', status: 'running', startedAt: 1, events: [], total: 0, truncated: 0 }] })
  const recovered = recoverAgentData(source)
  assert.equal(source.conversations[0].messages[0].status, 'streaming')
  assert.equal(recovered.conversations[0].messages[0].status, 'cancelled')
  assert.equal(recovered.conversations[0].messages[0].reasoningStatus, 'interrupted')
  assert.equal(recovered.calls[0].confirmationId, undefined)
  assert.equal(recovered.calls[0].status, 'cancelled')
  assert.equal(recovered.tasks[0].canStop, false)
  assert.equal(recovered.tasks[0].status, 'failed')
  assert.throws(() => parseAgentData({ ...source, version: 2 }))
  assert.throws(() => parseSettings({ version: 2, config: {} }))
})
