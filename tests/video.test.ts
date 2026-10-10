import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoService } from '../src/main/services/videoService'
import { FileSystemAdapter } from '../src/main/adapters/filesystem/fileSystemAdapter'

async function fixture(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-video-'))
  try {
    await mkdir(join(dir, 'source', 'item'), { recursive: true })
    await writeFile(join(dir, 'source', 'item', 'one.mp4'), 'video')
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('move uses the scanned file and returns the actual destination', async () =>
  fixture(async (dir) => {
    const service = new VideoService(new FileSystemAdapter())
    const found = await service.scan(join(dir, 'source'), null, new AbortController().signal)
    const plan = await service.prepareMove(found.id, [], join(dir, 'target'))
    const result = await service.executeMove(plan, new AbortController().signal)
    assert.equal(result.status, 'succeeded')
    assert.equal(await readFile(join(dir, 'target', 'one.mp4'), 'utf8'), 'video')
    await assert.rejects(access(join(dir, 'source', 'item', 'one.mp4')))
  }))

test('same source and destination are rejected before deleting anything', async () =>
  fixture(async (dir) => {
    const service = new VideoService(new FileSystemAdapter())
    const found = await service.scan(join(dir, 'source'), null, new AbortController().signal)
    await assert.rejects(service.prepareMove(found.id, [], join(dir, 'source', 'item')))
    assert.equal(await readFile(join(dir, 'source', 'item', 'one.mp4'), 'utf8'), 'video')
  }))

test('target occupied after preview is never overwritten', async () =>
  fixture(async (dir) => {
    const service = new VideoService(new FileSystemAdapter())
    const found = await service.scan(join(dir, 'source'), null, new AbortController().signal)
    await mkdir(join(dir, 'target'))
    const plan = await service.prepareMove(found.id, [], join(dir, 'target'))
    await writeFile(join(dir, 'target', 'one.mp4'), 'other')
    assert.equal((await service.executeMove(plan, new AbortController().signal)).status, 'failed')
    assert.equal(await readFile(join(dir, 'target', 'one.mp4'), 'utf8'), 'other')
    assert.equal(await readFile(join(dir, 'source', 'item', 'one.mp4'), 'utf8'), 'video')
  }))

test('source changed after preview requires a new preview', async () =>
  fixture(async (dir) => {
    const service = new VideoService(new FileSystemAdapter())
    const found = await service.scan(join(dir, 'source'), null, new AbortController().signal)
    const plan = await service.prepareMove(found.id, [], join(dir, 'target'))
    await writeFile(join(dir, 'source', 'item', 'one.mp4'), 'changed')
    const result = await service.executeMove(plan, new AbortController().signal)
    assert.equal(result.status, 'failed')
    await assert.rejects(access(join(dir, 'target', 'one.mp4')))
  }))

test('cancelled move retains source files', async () =>
  fixture(async (dir) => {
    const service = new VideoService(new FileSystemAdapter())
    const plan = await service.prepareMove(
      (await service.scan(join(dir, 'source'), null, new AbortController().signal)).id,
      [],
      join(dir, 'target')
    )
    const controller = new AbortController()
    controller.abort()
    assert.equal((await service.executeMove(plan, controller.signal)).status, 'cancelled')
    assert.equal(await readFile(join(dir, 'source', 'item', 'one.mp4'), 'utf8'), 'video')
  }))
