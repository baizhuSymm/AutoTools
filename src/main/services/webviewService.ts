import type { HdcExecResult } from '../../shared/ipc'
import type { ToolResult } from '../../shared/agent'
import type { ChromePort, ExternalLinkPort, HdcPort } from '../contracts/ports'
import { hasForwardPort } from '../utils/deviceOutput'
import type { DeviceService } from './deviceService'

export class WebviewService {
  constructor(
    private devices: DeviceService,
    private hdc: HdcPort,
    private chrome: ChromePort,
    private external: ExternalLinkPort
  ) {}
  private port(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  }
  private async command(
    deviceId: string,
    signal: AbortSignal,
    operation: () => Promise<HdcExecResult>
  ): Promise<ToolResult> {
    await this.devices.assertOnline(deviceId, signal)
    signal.throwIfAborted()
    const result = await operation()
    return {
      status: result.code === 0 ? 'succeeded' : signal.aborted ? 'cancelled' : 'failed',
      summary: result.code === 0 ? '设备操作已完成' : result.stderr || `退出码 ${result.code}`,
      data: result
    }
  }
  async probe(deviceId: string, signal: AbortSignal): Promise<ToolResult> {
    const output: Record<string, string[]> = {}
    const steps = [
      ['processes', () => this.hdc.queryProcesses(deviceId, signal)],
      ['sockets', () => this.hdc.querySockets(deviceId, signal)],
      ['forwarded', () => this.hdc.listForwards(deviceId, signal)]
    ] as const
    for (const [name, operation] of steps) {
      const result = await this.command(deviceId, signal, operation)
      if (result.status !== 'succeeded')
        return { ...result, data: { completed: output, failedStep: name } }
      output[name] = (result.data as HdcExecResult).stdout
        .split(/\r?\n/)
        .filter((line) =>
          name === 'forwarded' ? line.trim() : /webview|devtools|chromium/i.test(line)
        )
    }
    return { status: 'succeeded', summary: '设备探测完成', data: output }
  }
  enableDebugging(deviceId: string, signal: AbortSignal): Promise<ToolResult> {
    return this.command(deviceId, signal, () => this.hdc.enableDebugging(deviceId, signal))
  }
  async forwardPort(
    deviceId: string,
    port: number,
    socketName: string,
    signal: AbortSignal
  ): Promise<ToolResult> {
    this.port(port)
    if (
      !/^(?:localabstract:)?[a-zA-Z0-9_.-]+$/.test(socketName) ||
      socketName.length > (socketName.startsWith('localabstract:') ? 270 : 256)
    )
      throw new Error('调试 socket 无效')
    const socket = socketName.startsWith('localabstract:')
      ? socketName
      : `localabstract:${socketName}`
    const existing = await this.command(deviceId, signal, () =>
      this.hdc.listForwards(deviceId, signal)
    )
    if (existing.status !== 'succeeded') return existing
    if (hasForwardPort((existing.data as HdcExecResult).stdout, port))
      throw new Error('该端口已有转发，请选择其他端口或确认移除现有转发')
    return this.command(deviceId, signal, () =>
      this.hdc.createForward(deviceId, port, socket, signal)
    )
  }
  async removeForward(deviceId: string, port: number, signal: AbortSignal): Promise<ToolResult> {
    this.port(port)
    return this.command(deviceId, signal, () => this.hdc.removeForward(deviceId, port, signal))
  }
  async openEndpoint(
    deviceId: string,
    port: number,
    browser: 'default' | 'chrome',
    signal: AbortSignal
  ): Promise<ToolResult> {
    this.port(port)
    if (!['default', 'chrome'].includes(browser)) throw new Error('浏览器类型无效')
    const forwards = await this.command(deviceId, signal, () =>
      this.hdc.listForwards(deviceId, signal)
    )
    if (forwards.status !== 'succeeded') return forwards
    if (!hasForwardPort((forwards.data as HdcExecResult).stdout, port))
      throw new Error('未找到指定端口的转发')
    const url = `http://127.0.0.1:${port}/json/list`
    signal.throwIfAborted()
    await (browser === 'chrome' ? this.chrome : this.external).open(url)
    return { status: 'succeeded', summary: '已打开调试端点', data: { url } }
  }
}
