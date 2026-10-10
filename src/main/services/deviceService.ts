import type { HdcPort } from '../contracts/ports'
import { parseBundles, parseForeground, parseTargets } from '../utils/deviceOutput'

export class DeviceService {
  constructor(private hdc: HdcPort) {}
  async list(signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted()
    const result = await this.hdc.listTargets(signal)
    signal.throwIfAborted()
    if (result.code !== 0) throw new Error(result.stderr || '设备查询失败')
    return parseTargets(result.stdout)
  }
  async assertOnline(deviceId: string, signal: AbortSignal): Promise<void> {
    if (!/^[a-zA-Z0-9_.:-]{1,256}$/.test(deviceId)) throw new Error('设备 ID 无效')
    if (!(await this.list(signal)).includes(deviceId)) throw new Error('设备已断开，请重新选择设备')
  }
  async listApps(deviceId: string, signal: AbortSignal): Promise<string[]> {
    const querySignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    await this.assertOnline(deviceId, querySignal)
    const errors: string[] = []
    for (const variant of ['bm', 'pm', 'bm-user'] as const) {
      querySignal.throwIfAborted()
      const result = await this.hdc.queryBundles(deviceId, variant, querySignal)
      querySignal.throwIfAborted()
      errors.push(result.stderr)
      if (result.code === 0 && result.stdout.trim()) {
        const names = parseBundles(result.stdout, variant)
        if (names.length || variant === 'pm') return names
      }
    }
    throw new Error(`无法获取应用列表。hdc stderr: ${errors.find(Boolean)?.trim() || '(空)'}`)
  }
  async foregroundApp(deviceId: string, signal: AbortSignal): Promise<string | null> {
    const querySignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    await this.assertOnline(deviceId, querySignal)
    for (const variant of ['aa', 'window'] as const) {
      querySignal.throwIfAborted()
      const result = await this.hdc.queryForeground(deviceId, variant, querySignal)
      querySignal.throwIfAborted()
      if (result.code === 0) {
        const name = parseForeground(result.stdout, variant)
        if (name) return name
      }
    }
    return null
  }
}
