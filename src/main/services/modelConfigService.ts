import { z } from 'zod'
import type { ModelConfig } from '../../shared/agent'
import type { SecretVault } from '../agent/contracts'
import type { ConfigRepository } from '../repositories/configRepository'

export type ModelProbe = (
  config: ModelConfig,
  key: string
) => Promise<NonNullable<ModelConfig['capabilities']>>

export class ModelConfigService {
  private config: ModelConfig = { baseURL: '', model: '', hasKey: false, keyPersistent: false }
  private key = ''
  private revision = 0
  warning?: string
  constructor(
    private repository: ConfigRepository,
    private vault: SecretVault,
    private probe: ModelProbe,
    private isBusy: () => boolean,
    private changed: () => void
  ) {}
  initialize(): void {
    const state = this.repository.read()
    try {
      this.key = state.encryptedKey ? this.vault.decrypt(state.encryptedKey) : ''
    } catch {
      this.warning = '保存的密钥无法解密，请重新填写'
    }
    this.config = {
      ...state.config,
      hasKey: Boolean(this.key),
      keyPersistent: Boolean(this.key && state.encryptedKey)
    }
  }
  snapshot(): ModelConfig {
    return structuredClone(this.config)
  }
  credentials(): { config: ModelConfig; key: string } {
    if (!this.key || !this.config.baseURL || !this.config.model)
      throw new Error('请先配置 API 地址、Key 和模型名称')
    return { config: this.snapshot(), key: this.key }
  }
  async save(input: { baseURL: string; model: string; key?: string }): Promise<ModelConfig> {
    if (this.isBusy()) throw new Error('请先停止当前对话再修改模型设置')
    const parsed = z
      .object({ baseURL: z.url(), model: z.string().trim().min(1), key: z.string().optional() })
      .parse(input)
    const url = new URL(parsed.baseURL)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('API 地址无效')
    const nextKey = parsed.key === undefined ? this.key : parsed.key.trim()
    const encrypted = nextKey ? (this.vault.encrypt(nextKey) ?? undefined) : undefined
    const stored = { baseURL: parsed.baseURL.replace(/\/+$/, ''), model: parsed.model }
    this.repository.saveConfig(stored, encrypted)
    this.key = nextKey
    this.config = { ...stored, hasKey: Boolean(nextKey), keyPersistent: Boolean(encrypted) }
    this.revision++
    this.warning = undefined
    this.changed()
    return this.snapshot()
  }
  async setCapabilities(capabilities: NonNullable<ModelConfig['capabilities']>): Promise<void> {
    const { hasKey: _hasKey, keyPersistent: _persistent, ...stored } = this.config
    this.repository.saveConfig({ ...stored, capabilities }, this.repository.read().encryptedKey)
    this.config.capabilities = structuredClone(capabilities)
    this.changed()
  }
  async testConnection(): Promise<ModelConfig> {
    if (this.isBusy()) throw new Error('请先停止当前对话再测试连接')
    const credentials = this.credentials()
    const revision = this.revision
    const capabilities = await this.probe(credentials.config, credentials.key)
    if (revision !== this.revision) throw new Error('模型配置已变化，请重新测试当前配置')
    await this.setCapabilities(capabilities)
    return this.snapshot()
  }
  sanitize(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return (this.key ? message.split(this.key).join('[REDACTED]') : message).slice(0, 2000)
  }
}
