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
export function execHdc(
  args: string[],
  options: { signal?: AbortSignal; timeout?: number } = {}
): Promise<HdcExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(getHdcPath(), args, {
      cwd: getToolchainsDir(),
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const abort = (): void => {
      proc.kill()
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, options.timeout ?? 30000)
    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
    proc.stdout.on('data', (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-1048576)
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-1048576)
    })
    proc.on('close', (code) => {
      cleanup()
      resolve({
        code: timedOut || options.signal?.aborted ? -1 : (code ?? -1),
        stdout,
        stderr: timedOut ? '设备查询超时' : options.signal?.aborted ? '操作已取消' : stderr
      })
    })
    proc.on('error', (err) => {
      cleanup()
      resolve({ code: -1, stdout: '', stderr: err.message })
    })
  })
}

// ============== 应用查询 ==============

/**
 * 查询设备上已安装的应用 bundle 列表。
 * 优先用 `bm dump -a`(HarmonyOS 原生),失败则 fallback 到 `pm list packages`。
 */
export async function listInstalledBundles(
  deviceId?: string,
  signal?: AbortSignal,
  run = execHdc
): Promise<string[]> {
  const target = deviceId ? ['-t', deviceId] : []
  const querySignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000)
  querySignal.throwIfAborted()
  // 方案 1: bm dump -a,按 BundleName: xxx 提取
  const r1 = await run([...target, 'shell', 'bm', 'dump', '-a'], { signal: querySignal })
  querySignal.throwIfAborted()
  if (r1.code === 0 && r1.stdout.trim()) {
    const names = new Set<string>()
    for (const line of r1.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*BundleName\s*[:=]\s*(\S+)/)
      if (m) names.add(m[1].trim())
    }
    if (names.size > 0) return Array.from(names).sort()
  }

  // 方案 2: pm list packages
  const r2 = await run([...target, 'shell', 'pm', 'list', 'packages'], { signal: querySignal })
  querySignal.throwIfAborted()
  if (r2.code === 0 && r2.stdout.trim()) {
    return r2.stdout
      .split(/\r?\n/)
      .map((s) => s.replace(/^package:/, '').trim())
      .filter(Boolean)
      .sort()
  }

  // 方案 3: bm dump --user 0
  const r3 = await run([...target, 'shell', 'bm', 'dump', '--user', '0'], { signal: querySignal })
  querySignal.throwIfAborted()
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
export async function getForegroundBundle(
  deviceId?: string,
  signal?: AbortSignal,
  run = execHdc
): Promise<string | null> {
  const target = deviceId ? ['-t', deviceId] : []
  const querySignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000)
  querySignal.throwIfAborted()
  // 方案 1: HarmonyOS 4.0+ aa 子命令
  const r1 = await run([...target, 'shell', 'aa', 'current-foreground'], { signal: querySignal })
  querySignal.throwIfAborted()
  if (r1.code === 0) {
    const out = r1.stdout.trim()
    const m = out.match(/bundleName\s*[:=]\s*(\S+)/i) || out.match(/^([\w.]+)$/)
    if (m && m[1] && m[1] !== ' ') return m[1]
  }

  // 方案 2: dumpsys window
  const r2 = await run([...target, 'shell', 'dumpsys', 'window'], { signal: querySignal })
  querySignal.throwIfAborted()
  if (r2.code === 0) {
    const focusMatch = r2.stdout.match(/mCurrentFocus\s*=\s*[^/]*\/(\S+)/)
    if (focusMatch && focusMatch[1]) {
      const name = focusMatch[1].replace(/[{}].*$/, '').trim()
      if (name) return name
    }
  }

  return null
}
