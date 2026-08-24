import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 按平台给出常见 Chrome 安装路径候选
 */
function getCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['USERPROFILE'] ?? '', 'scoop\\apps\\googlechrome\\current\\chrome.exe')
    ]
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge'
  ]
}

export function detectChromePath(): string | null {
  for (const p of getCandidates()) {
    if (p && existsSync(p)) return p
  }
  return null
}

/**
 * 独立的 Chrome profile 目录。
 * 绕过主 profile 的锁冲突(主 profile 持有锁时新启动会 abort)。
 * 固定路径让用户对 inspect 的配置(如 discovery devices)能持久化。
 */
const INSPECT_PROFILE_DIR = join(tmpdir(), 'auto-tools-chrome-inspect')

function ensureProfileDir(): string {
  if (!existsSync(INSPECT_PROFILE_DIR)) {
    mkdirSync(INSPECT_PROFILE_DIR, { recursive: true })
  }
  return INSPECT_PROFILE_DIR
}

/**
 * 启动 Chrome 并打开 URL。
 *
 * 关键点:
 * - `--user-data-dir=<独立目录>` 绕开主 profile 的单实例锁冲突
 * - `--new-window` 强制新窗口
 * - `--no-first-run --no-default-browser-check` 防止弹窗
 * - `detached: true` + `unref()` 让 Chrome 独立于父进程
 */
export async function launchChrome(chromePath: string, url: string): Promise<void> {
  if (!chromePath) {
    throw new Error('Chrome 路径为空')
  }
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome 路径不存在: ${chromePath}`)
  }
  if (!url) {
    throw new Error('URL 为空')
  }

  const profileDir = ensureProfileDir()
  const targetUrl = url.startsWith('chrome://inspect') ? 'chrome://inspect' : url

  const args = [
    `--user-data-dir=${profileDir}`,
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    targetUrl
  ]
  console.log('[chrome] launching:', chromePath, args.join(' '))

  const proc = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })

  proc.unref()

  await new Promise<void>((resolve, reject) => {
    let done = false
    const finish = (err?: Error) => {
      if (done) return
      done = true
      if (err) reject(err)
      else resolve()
    }
    proc.once('error', (err) => {
      console.error('[chrome] spawn error:', err.message)
      finish(err)
    })
    proc.once('spawn', () => {
      console.log('[chrome] spawned, pid =', proc.pid)
      finish()
    })
    setTimeout(() => finish(), 1000)
  })
}
