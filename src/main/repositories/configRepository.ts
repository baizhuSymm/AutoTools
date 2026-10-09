import type { SettingsStore } from '../storage/settingsStore'
import type { SettingsData, StoredConfig } from '../storage/schema'

export class ConfigRepository {
  constructor(private settings: SettingsStore) {}
  read(): SettingsData {
    return this.settings.read()
  }
  saveConfig(config: StoredConfig, encryptedKey?: string): void {
    return this.settings.replace({ ...this.read(), config, encryptedKey })
  }
}
