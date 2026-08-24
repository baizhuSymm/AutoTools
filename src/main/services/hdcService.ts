import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { HdcExecResult } from '../../shared/ipc'

function getToolchainsBase(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
}

function getHdcPath(): string {
  const exe = process.platform === 'win32' ? 'hdc.exe' : 'hdc'
  return join(getToolchainsBase(), 'toolchains', exe)
}

function getToolchainsDir(): string {
  return join(getToolchainsBase(), 'toolchains')
}

/**
 * 执行 hdc 命令,等待结束返回结果。
 * 不用 shell:true,避免 args 被 shell 再次拆分导致的安全/转义问题。
 */
export function execHdc(args: string[]): Promise<HdcExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(getHdcPath(), args, {
      cwd: getToolchainsDir(),
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })
    proc.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message })
    })
  })
}

// ============== 流式 hdc 进程 ==============

export interface HdcStreamEvents {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  close: (code: number) => void
  error: (err: Error) => void
}

export interface HdcStreamHandle {
  id: string
  stop: () => Promise<void>
  on<K extends keyof HdcStreamEvents>(event: K, listener: HdcStreamEvents[K]): HdcStreamHandle
  off<K extends keyof HdcStreamEvents>(event: K, listener: HdcStreamEvents[K]): HdcStreamHandle
}

/**
 * 启动一个长驻 hdc 进程,逐步把 stdout/stderr 推给监听者。
 * 适合 hilog 这类永不退出的命令。
 */
export function spawnHdcStream(args: string[]): HdcStreamHandle {
  const emitter = new EventEmitter()
  const proc = spawn(getHdcPath(), args, {
    cwd: getToolchainsDir(),
    windowsHide: true
  })

  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')

  proc.stdout.on('data', (chunk: string) => emitter.emit('stdout', chunk))
  proc.stderr.on('data', (chunk: string) => emitter.emit('stderr', chunk))
  proc.on('close', (code) => emitter.emit('close', code ?? -1))
  proc.on('error', (err: Error) => emitter.emit('error', err))

  const id = `hdc-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const handle: HdcStreamHandle = {
    id,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.once('close', () => resolve())
        try {
          proc.kill()
        } catch {
          resolve()
        }
        // 兜底:2s 后强制 resolve,避免死锁
        setTimeout(() => resolve(), 2000)
      }),
    on(event, listener) {
      emitter.on(event, listener as (...args: unknown[]) => void)
      return handle
    },
    off(event, listener) {
      emitter.off(event, listener as (...args: unknown[]) => void)
      return handle
    }
  }
  return handle
}

// ============== 应用查询 ==============

/**
 * 查询设备上已安装的应用 bundle 列表。
 * 优先用 `bm dump -a`(HarmonyOS 原生),失败则 fallback 到 `pm list packages`。
 */
export async function listInstalledBundles(): Promise<string[]> {
  // 方案 1: bm dump -a,按 BundleName: xxx 提取
  const r1 = await execHdc(['shell', 'bm', 'dump', '-a'])
  if (r1.code === 0 && r1.stdout.trim()) {
    const names = new Set<string>()
    for (const line of r1.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*BundleName\s*[:=]\s*(\S+)/)
      if (m) names.add(m[1].trim())
    }
    if (names.size > 0) return Array.from(names).sort()
  }

  // 方案 2: pm list packages
  const r2 = await execHdc(['shell', 'pm', 'list', 'packages'])
  if (r2.code === 0 && r2.stdout.trim()) {
    return r2.stdout
      .split(/\r?\n/)
      .map((s) => s.replace(/^package:/, '').trim())
      .filter(Boolean)
      .sort()
  }

  // 方案 3: bm dump --user 0
  const r3 = await execHdc(['shell', 'bm', 'dump', '--user', '0'])
  if (r3.code === 0 && r3.stdout.trim()) {
    const names = new Set<string>()
    for (const line of r3.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*BundleName\s*[:=]\s*(\S+)/)
      if (m) names.add(m[1].trim())
    }
    if (names.size > 0) return Array.from(names).sort()
  }

  throw new Error(
    `无法获取应用列表。hdc stderr: ${(r1.stderr || r2.stderr || r3.stderr).trim() || '(空)'}`
  )
}

/**
 * 获取当前前台应用的 bundle 名。
 * 依次尝试 `aa current-foreground`、`dumpsys window | grep mCurrentFocus`。
 * 无法识别时返回 null。
 */
export async function getForegroundBundle(): Promise<string | null> {
  // 方案 1: HarmonyOS 4.0+ aa 子命令
  const r1 = await execHdc(['shell', 'aa', 'current-foreground'])
  if (r1.code === 0) {
    const out = r1.stdout.trim()
    const m =
      out.match(/bundleName\s*[:=]\s*(\S+)/i) ||
      out.match(/^([\w.]+)$/)
    if (m && m[1] && m[1] !== ' ') return m[1]
  }

  // 方案 2: dumpsys window
  const r2 = await execHdc(['shell', 'dumpsys', 'window'])
  if (r2.code === 0) {
    const focusMatch = r2.stdout.match(/mCurrentFocus\s*=\s*[^/]*\/(\S+)/)
    if (focusMatch && focusMatch[1]) {
      const name = focusMatch[1].replace(/[{}].*$/, '').trim()
      if (name) return name
    }
  }

  return null
}