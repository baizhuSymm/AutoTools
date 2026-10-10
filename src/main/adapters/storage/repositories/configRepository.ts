import type { SettingsStore } from '../settingsStore'
import type { StoredConfig } from '../../../contracts/agent'

export class ConfigRepository {
  constructor(private settings: SettingsStore) {}
  readConfig(): { config: StoredConfig; encryptedKey?: string } {
    const { config, encryptedKey } = this.settings.read()
    return { config, encryptedKey }
  }
  saveConfig(config: StoredConfig, encryptedKey?: string): void {
    return this.settings.replace({ ...this.settings.read(), config, encryptedKey })
  }
}
