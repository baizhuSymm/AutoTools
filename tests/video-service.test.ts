import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoService } from '../src/main/services/videoService'
import { FileSystemAdapter } from '../src/main/adapters/filesystem/fileSystemAdapter'

async function fixture(run: (dir: string, service: VideoService) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'video-service-'))
  try {
    await mkdir(join(dir, 'source', 'item'), { recursive: true })
    await writeFile(join(dir, 'source', 'item', 'one.mp4'), 'video')
    await run(dir, new VideoService(new FileSystemAdapter()))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
const signal = (): AbortSignal => new AbortController().signal

test('video scan cache is isolated bounded and exposes detached public files', async () =>
  fixture(async (dir, service) => {
    const found = await service.scan(join(dir, 'source'), null, signal())
    assert.equal(service.results(found.id, 0, 10, '').total, 1)
    assert.equal('fingerprint' in found.files[0], false)
    found.files[0].name = 'tampered'
    assert.equal(service.results(found.id, 0, 10, '').files[0].name, 'one.mp4')
    assert.throws(
      () => new VideoService(new FileSystemAdapter()).results(found.id, 0, 10, ''),
      /过期/
    )
    let last = found
    for (let i = 0; i < 20; i++) last = await service.scan(join(dir, 'source'), null, signal())
    assert.throws(() => service.results(found.id, 0, 10, ''), /过期/)
    assert.equal(service.results(last.id, 0, 10, '').total, 1)
    assert.throws(() => service.results(last.id, 0, 31, ''))
    assert.throws(() => service.results(last.id, -1, 10, ''))
  }))

test('video copy-time race never overwrites target or changes the approved destination', async () =>
  fixture(async (dir) => {
    class RacingFiles extends FileSystemAdapter {
      override async copyExclusive(source: string, destination: string): Promise<void> {
        await writeFile(destination, 'other')
        return super.copyExclusive(source, destination)
      }
    }
    const service = new VideoService(new RacingFiles())
    const found = await service.scan(join(dir, 'source'), null, signal())
    const plan = await service.prepareMove(found.id, [], join(dir, 'target'))
    const result = await service.executeMove(plan, signal())
    assert.equal(result.status, 'failed')
    const data = result.data as { failed: { copied: boolean; destination: string }[] }
    assert.equal(data.failed[0].copied, false)
    assert.equal(data.failed[0].destination, plan.items[0].destination)
    assert.equal(await readFile(join(dir, 'target', 'one.mp4'), 'utf8'), 'other')
    assert.equal(await readFile(join(dir, 'source', 'item', 'one.mp4'), 'utf8'), 'video')
    await assert.rejects(access(join(dir, 'target', 'one_1.mp4')))
  }))

test('cancellation after the first move preserves partial facts and remaining source', async () =>
  fixture(async (dir) => {
    await writeFile(join(dir, 'source', 'item', 'two.mp4'), 'two')
    const controller = new AbortController()
    class CancellingFiles extends FileSystemAdapter {
      override async removeFile(path: string): Promise<void> {
        await super.removeFile(path)
        controller.abort()
      }
    }
    const service = new VideoService(new CancellingFiles())
    const found = await service.scan(join(dir, 'source'), null, signal())
    const plan = await service.prepareMove(found.id, [], join(dir, 'target'))
    const result = await service.executeMove(plan, controller.signal)
    assert.equal(result.status, 'partial')
    const data = result.data as { moved: unknown[]; cancelled: number }
    assert.equal(data.moved.length, 1)
    assert.equal(data.cancelled, 1)
    assert.equal(await readFile(plan.items[1].source, 'utf8'), 'two')
    assert.equal(await readFile(plan.items[0].destination, 'utf8'), 'video')
  }))

test('scan date uses immediate child-folder mtime rather than video mtime', async () =>
  fixture(async (dir, service) => {
    const folder = join(dir, 'source', 'item')
    await mkdir(join(folder, 'nested'))
    await writeFile(join(folder, 'nested', 'nested.mp4'), 'nested')
    await writeFile(join(dir, 'source', 'root.mp4'), 'root')
    await writeFile(join(folder, 'ignored.txt'), 'text')
    await utimes(join(folder, 'one.mp4'), new Date(2000, 0, 1), new Date(2000, 0, 1))
    await utimes(folder, new Date(2026, 9, 10, 12), new Date(2026, 9, 10, 12))
    const found = await service.scan(
      join(dir, 'source'),
      { start: '2026-10-10', end: '2026-10-10' },
      signal()
    )
    assert.deepEqual(
      found.files.map((file) => file.name),
      ['one.mp4']
    )
    assert.equal(
      (
        await service.scan(
          join(dir, 'source'),
          { start: '2026-10-11', end: '2026-10-11' },
          signal()
        )
      ).files.length,
      0
    )
    await assert.rejects(service.scan(join(dir, 'source'), { start: 'bad', end: 'bad' }, signal()))
  }))

test('prepared moves keep collision suffixes and reject unknown file references', async () =>
  fixture(async (dir, service) => {
    await mkdir(join(dir, 'target'))
    await writeFile(join(dir, 'target', 'one.mp4'), 'other')
    const found = await service.scan(join(dir, 'source'), null, signal())
    const plan = await service.prepareMove(
      found.id,
      [found.files[0].id, found.files[0].id],
      join(dir, 'target')
    )
    assert.equal(plan.items.length, 1)
    assert.equal(plan.items[0].destination, join(dir, 'target', 'one_1.mp4'))
    await assert.rejects(service.prepareMove(found.id, ['unknown'], join(dir, 'target')))
    assert.equal((await service.executeMove(plan, signal())).status, 'succeeded')
    assert.equal(await readFile(join(dir, 'target', 'one.mp4'), 'utf8'), 'other')
  }))

test('changed canonical target cannot redirect an approved move', async () =>
  fixture(async (dir) => {
    let changed = false
    const target = join(dir, 'target')
    class ChangedPaths extends FileSystemAdapter {
      override realPath(path: string): Promise<string> {
        if (changed && path === target) return Promise.resolve(join(dir, 'elsewhere'))
        return super.realPath(path)
      }
    }
    const service = new VideoService(new ChangedPaths())
    const found = await service.scan(join(dir, 'source'), null, signal())
    const plan = await service.prepareMove(found.id, [], target)
    changed = true
    assert.equal((await service.executeMove(plan, signal())).status, 'failed')
    assert.equal(await readFile(plan.items[0].source, 'utf8'), 'video')
  }))

test('real directory-link replacement is rejected after preview', async (context) =>
  fixture(async (dir, service) => {
    const target = join(dir, 'target'),
      elsewhere = join(dir, 'elsewhere')
    await mkdir(target)
    await mkdir(elsewhere)
    const found = await service.scan(join(dir, 'source'), null, signal())
    const plan = await service.prepareMove(found.id, [], target)
    await rm(target, { recursive: true })
    try {
      await symlink(elsewhere, target, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
        if (['EPERM', 'EACCES'].includes((error as { code?: string }).code ?? '')) {
        context.skip('OS does not allow directory links')
        return
      }
      throw error
    }
    assert.equal((await service.executeMove(plan, signal())).status, 'failed')
    await assert.rejects(access(join(elsewhere, 'one.mp4')))
    assert.equal(await readFile(plan.items[0].source, 'utf8'), 'video')
  }))
