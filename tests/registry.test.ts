import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRegistry, hasForwardPort } from '../src/main/tools/registry'
import { ToolExecutor } from '../src/main/tools/executor'
import { MonitorManager } from '../src/main/tasks/monitor'

test('forward checks match the complete port rather than a numeric prefix', () => {
  assert.equal(hasForwardPort('tcp:92221 localabstract:test', 9222), false)
  assert.equal(hasForwardPort('tcp:9222 localabstract:test', 9222), true)
})

test('scan references can be queried in pages and filtered without rescanning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pages-'))
  try {
    await mkdir(join(directory, 'item'))
    for (let i = 0; i < 35; i++)
      await writeFile(join(directory, 'item', `video-${String(i).padStart(2, '0')}.mp4`), 'video')
    const registry = createRegistry(
      new MonitorManager(
        () => {
          throw new Error('not used')
        },
        () => {}
      )
    )
    const executor = new ToolExecutor(registry)
    const context = { scope: 'test', signal: new AbortController().signal, update: () => {} }
    const scan = await executor.execute('video.scan', { sourceDir: directory }, context)
    const id = (scan.data as { id: string }).id
    const page = await executor.execute(
      'video.results',
      { scanId: id, offset: 10, limit: 5 },
      context
    )
    assert.equal(page.status, 'succeeded')
    const result = page.data as {
      files: { id: string; name: string }[]
      total: number
      nextOffset: number
    }
    assert.equal(result.files.length, 5)
    assert.equal(result.total, 35)
    assert.equal(result.nextOffset, 15)
    const filtered = await executor.execute(
      'video.results',
      { scanId: id, query: 'video-12' },
      context
    )
    assert.equal((filtered.data as typeof result).files[0].name, 'video-12.mp4')
    assert.ok((filtered.data as typeof result).files[0].id)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
