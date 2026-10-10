import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChromePort } from '../../contracts/ports'

function getCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      join(
        process.env['PROGRAMFILES'] ?? 'C:\\Program Files',
        'Google\\Chrome\\Application\\chrome.exe'
      ),
      join(
        process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
        'Google\\Chrome\\Application\\chrome.exe'
      ),
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

interface ChromeOptions {
  exists?: typeof existsSync
  mkdir?: typeof mkdirSync
  spawn?: typeof spawn
  candidates?: () => string[]
}
export class ChromeAdapter implements ChromePort {
  constructor(private options: ChromeOptions = {}) {}
  async open(url: string): Promise<void> {
    const exists = this.options.exists ?? existsSync
    const chrome = (this.options.candidates ?? getCandidates)().find((path) => path && exists(path))
    if (!chrome) throw new Error('未检测到 Chrome')
    if (!url) throw new Error('URL 为空')
    const profile = join(tmpdir(), 'auto-tools-chrome-inspect')
    if (!exists(profile)) (this.options.mkdir ?? mkdirSync)(profile, { recursive: true })
    const proc = (this.options.spawn ?? spawn)(
      chrome,
      [
        `--user-data-dir=${profile}`,
        '--new-window',
        '--no-first-run',
        '--no-default-browser-check',
        url.startsWith('chrome://inspect') ? 'chrome://inspect' : url
      ],
      { detached: true, stdio: 'ignore', windowsHide: false }
    )
    proc.unref()
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer)
        proc.removeListener('error', onError)
        proc.removeListener('spawn', onSpawn)
        if (error) reject(error)
        else resolve()
      }
      const onError = (error: Error): void => finish(error)
      const onSpawn = (): void => finish()
      const timer = setTimeout(() => finish(), 1000)
      proc.once('error', onError)
      proc.once('spawn', onSpawn)
    })
  }
}
