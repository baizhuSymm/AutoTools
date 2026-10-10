import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { HdcExecResult } from '../../../shared/ipc'
import type { HdcPort } from '../../contracts/ports'

type Run = (
  args: string[],
  options: { signal?: AbortSignal; timeout?: number }
) => Promise<HdcExecResult>
interface HdcOptions {
  run?: Run
  spawn?: typeof spawn
  toolchainsBase?: () => string
}

export class HdcAdapter implements HdcPort {
  constructor(private options: HdcOptions = {}) {}
  private run(args: string[], signal: AbortSignal): Promise<HdcExecResult> {
    if (signal.aborted) return Promise.resolve({ code: -1, stdout: '', stderr: '操作已取消' })
    if (this.options.run) return this.options.run(args, { signal })
    return new Promise((resolve) => {
      const base =
        this.options.toolchainsBase?.() ??
        (app.isPackaged
          ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
          : join(app.getAppPath(), 'resources'))
      const proc = (this.options.spawn ?? spawn)(
        join(base, 'toolchains', process.platform === 'win32' ? 'hdc.exe' : 'hdc'),
        args,
        {
          cwd: join(base, 'toolchains'),
          windowsHide: true
        }
      )
      let stdout = '',
        stderr = '',
        timedOut = false
      const abort = (): void => {
        proc.kill()
      }
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill()
      }, 30000)
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
      signal.addEventListener('abort', abort, { once: true })
      proc.stdout!.on('data', (data: Buffer) => {
        stdout = (stdout + data.toString()).slice(-1048576)
      })
      proc.stderr!.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-1048576)
      })
      proc.on('close', (code) => {
        cleanup()
        resolve({
          code: timedOut || signal.aborted ? -1 : (code ?? -1),
          stdout,
          stderr: timedOut ? '设备查询超时' : signal.aborted ? '操作已取消' : stderr
        })
      })
      proc.on('error', (error) => {
        cleanup()
        resolve({ code: -1, stdout: '', stderr: error.message })
      })
    })
  }
  private target(deviceId: string, args: string[], signal: AbortSignal): Promise<HdcExecResult> {
    return this.run(['-t', deviceId, ...args], signal)
  }
  listTargets(signal: AbortSignal): Promise<HdcExecResult> {
    return this.run(['list', 'targets'], signal)
  }
  queryBundles(
    deviceId: string,
    variant: 'bm' | 'pm' | 'bm-user',
    signal: AbortSignal
  ): Promise<HdcExecResult> {
    const args =
      variant === 'pm'
        ? ['pm', 'list', 'packages']
        : ['bm', 'dump', ...(variant === 'bm' ? ['-a'] : ['--user', '0'])]
    return this.target(deviceId, ['shell', ...args], signal)
  }
  queryForeground(
    deviceId: string,
    variant: 'aa' | 'window',
    signal: AbortSignal
  ): Promise<HdcExecResult> {
    return this.target(
      deviceId,
      ['shell', ...(variant === 'aa' ? ['aa', 'current-foreground'] : ['dumpsys', 'window'])],
      signal
    )
  }
  queryProcesses(deviceId: string, signal: AbortSignal): Promise<HdcExecResult> {
    return this.target(deviceId, ['shell', 'ps', '-ef'], signal)
  }
  querySockets(deviceId: string, signal: AbortSignal): Promise<HdcExecResult> {
    return this.target(deviceId, ['shell', 'cat', '/proc/net/unix'], signal)
  }
  listForwards(deviceId: string, signal: AbortSignal): Promise<HdcExecResult> {
    return this.target(deviceId, ['fport', 'ls'], signal)
  }
  enableDebugging(deviceId: string, signal: AbortSignal): Promise<HdcExecResult> {
    return this.target(
      deviceId,
      ['shell', 'setprop', 'debug.webview.remote_debugging', 'true'],
      signal
    )
  }
  createForward(
    deviceId: string,
    port: number,
    socketName: string,
    signal: AbortSignal
  ): Promise<HdcExecResult> {
    return this.target(deviceId, ['fport', `tcp:${port}`, socketName], signal)
  }
  removeForward(deviceId: string, port: number, signal: AbortSignal): Promise<HdcExecResult> {
    return this.target(deviceId, ['fport', 'rm', `tcp:${port}`], signal)
  }
}
