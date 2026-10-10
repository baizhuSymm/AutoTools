import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRegistry } from '../src/main/tools/registry'
import { ToolExecutor } from '../src/main/tools/executor'
import { AgentDatabase } from '../src/main/storage/agentDatabase'
import { parseAgentData, parseLegacy } from '../src/main/storage/schema'

test('removed monitoring tools are not registered and cannot be executed', async () => {
  const definitions = createRegistry()
  assert.equal(
    definitions.some((tool) => tool.name.startsWith('crash.')),
    false
  )
  assert.ok(definitions.some((tool) => tool.name === 'video.move'))
  assert.ok(definitions.some((tool) => tool.name === 'webview.probe'))
  const executor = new ToolExecutor(definitions)
  for (const name of ['crash.start', 'crash.stop', 'crash.status', 'crash.export']) {
    const result = await executor.execute(
      name,
      {},
      {
        scope: 'test',
        signal: new AbortController().signal,
        update: (call) => assert.equal(call.confirmationId, undefined)
      }
    )
    assert.equal(result.status, 'failed')
    assert.equal(result.summary, '未知工具')
  }
})

test('old monitoring fields are ignored while conversations, history and calls survive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'removed-monitor-'))
  const old = {
    version: 1,
    conversations: [{ id: 's', title: 'kept', updatedAt: 1, messages: [] }],
    history: { s: [[{ role: 'user', content: 'kept' }]] },
    calls: [{ id: 'c', scope: 's', name: 'video.scan', title: 'scan', status: 'succeeded' }],
    tasks: [
      {
        id: 'obsolete',
        status: 'running',
        deviceId: 'd',
        bundleName: 'a',
        startedAt: 1,
        events: [],
        total: 0,
        truncated: 0
      }
    ]
  }
  try {
    const parsed = parseAgentData(old)
    assert.equal('tasks' in parsed, false)
    assert.equal('tasks' in parseLegacy({ ...old, config: { baseURL: '', model: '' } }), false)
    assert.deepEqual(parseAgentData({ ...old, tasks: null }), parsed)
    await writeFile(join(directory, 'agent-data.json'), JSON.stringify(old))
    const database = await AgentDatabase.open(directory)
    await database.commit()
    const saved = JSON.parse(await readFile(join(directory, 'agent-data.json'), 'utf8'))
    assert.equal('tasks' in saved, false)
    assert.deepEqual(saved.conversations, old.conversations)
    assert.deepEqual(saved.history, old.history)
    assert.deepEqual(saved.calls, old.calls)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
