import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { spawn } from 'node:child_process'
import { FileSystemAdapter } from '../src/main/adapters/filesystem/fileSystemAdapter'
import { HdcAdapter } from '../src/main/adapters/device/hdcAdapter'
import { ChromeAdapter } from '../src/main/adapters/browser/chromeAdapter'
import { DialogAdapter } from '../src/main/adapters/electron/dialogAdapter'
import { ExternalLinkAdapter } from '../src/main/adapters/electron/externalLinkAdapter'
import { parseBundles, parseForeground, parseTargets } from '../src/main/utils/deviceOutput'

test('exclusive filesystem copy never overwrites an occupied target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adapter-copy-'))
  try {
    const source = join(dir, 'source'),
      destination = join(dir, 'target')
    await writeFile(source, 'video')
    await writeFile(destination, 'other')
    const files = new FileSystemAdapter()
    await assert.rejects(files.copyExclusive(source, destination))
    assert.equal(await readFile(destination, 'utf8'), 'other')
    assert.equal((await files.info(source, false)).kind, 'file')
    assert.deepEqual(
      (await files.readDirectory(dir)).map((item) => item.kind),
      ['file', 'file']
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('named HDC capabilities preserve chosen device command and signal', async () => {
  const calls: string[][] = []
  const signal = new AbortController().signal
  const hdc = new HdcAdapter({
    run: async (args, options) => {
      assert.equal(options.signal, signal)
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    }
  })
  await hdc.createForward('chosen', 9222, 'localabstract:test', signal)
  await hdc.queryBundles('chosen', 'bm-user', signal)
  await hdc.queryForeground('chosen', 'window', signal)
  assert.deepEqual(calls, [
    ['-t', 'chosen', 'fport', 'tcp:9222', 'localabstract:test'],
    ['-t', 'chosen', 'shell', 'bm', 'dump', '--user', '0'],
    ['-t', 'chosen', 'shell', 'dumpsys', 'window']
  ])
})

function processFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {
      child.emit('close', -1)
      return true
    }
  })
  return child
}

test('HDC timeout and abort kill processes and bound output without a shell', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const child = processFixture()
  let starts = 0
  const hdc = new HdcAdapter({
    toolchainsBase: () => 'C:/test/resources',
    spawn: ((_path, _args, options) => {
      starts++
      assert.equal(options.windowsHide, true)
      assert.notEqual(options.shell, true)
      return child
    }) as typeof spawn
  })
  const controller = new AbortController()
  const pending = hdc.listTargets(controller.signal)
  child.stdout.write('x'.repeat(1048577))
  child.stderr.write('y'.repeat(1048577))
  context.mock.timers.tick(30000)
  const result = await pending
  assert.equal(result.code, -1)
  assert.equal(result.stdout.length, 1048576)
  assert.match(result.stderr, /超时/)
  const aborting = hdc.listTargets(controller.signal)
  controller.abort()
  assert.equal((await aborting).code, -1)
  assert.equal((await hdc.listTargets(controller.signal)).code, -1)
  assert.equal(starts, 2)
})

test('cancelled folder dialog returns null and browser adapters open only supplied URL', async () => {
  assert.equal(
    await new DialogAdapter(async () => ({
      canceled: true,
      filePaths: ['ignored']
    })).selectFolder(),
    null
  )
  assert.equal(
    await new DialogAdapter(async () => ({
      canceled: false,
      filePaths: ['C:/selected']
    })).selectFolder(),
    'C:/selected'
  )
  const urls: string[] = []
  await new ExternalLinkAdapter(async (url) => {
    urls.push(url)
  }).open('http://127.0.0.1:9222/json/list')
  assert.deepEqual(urls, ['http://127.0.0.1:9222/json/list'])
  let args: string[] = []
  const chrome = new ChromeAdapter({
    candidates: () => ['chrome.exe'],
    exists: () => true,
    spawn: ((_path, values, options) => {
      args = values
      assert.equal(options.detached, true)
      assert.equal(options.stdio, 'ignore')
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    }) as typeof spawn
  })
  await chrome.open(urls[0])
  assert.match(args[0], /auto-tools-chrome-inspect$/)
  assert.equal(args.at(-1), urls[0])
  assert.ok(args.includes('--new-window'))
  await assert.rejects(
    new ChromeAdapter({ candidates: () => [], exists: () => false }).open(urls[0]),
    /Chrome/
  )
})

test('device output compatibility keeps filtering fallback formats and bundle ordering', () => {
  assert.deepEqual(parseTargets('[Empty]\nchosen\nno devices\n'), ['chosen'])
  assert.deepEqual(parseBundles('BundleName: z.app\nBundleName=a.app\nBundleName: z.app', 'bm'), [
    'a.app',
    'z.app'
  ])
  assert.deepEqual(parseBundles('package:z.app\npackage:a.app', 'pm'), ['a.app', 'z.app'])
  assert.equal(parseForeground('bundleName: a.app', 'aa'), 'a.app')
  assert.equal(parseForeground('mCurrentFocus = Window{123 /a.app}', 'window'), 'a.app')
  assert.equal(parseForeground('unrecognized output', 'window'), null)
})
