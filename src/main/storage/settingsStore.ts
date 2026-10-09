import { parseSettings, type SettingsData } from './schema'

export interface SettingsBackend { store: Record<string, unknown> }
export type SettingsBackendFactory = (directory: string) => Promise<SettingsBackend>
export const emptySettings = (): SettingsData => ({ version: 1, config: { baseURL: '', model: '' } })

const electronSettings: SettingsBackendFactory = async (directory) => {
  const { default: Store } = await import('electron-store')
  return new Store({ cwd: directory, name: 'agent-settings', accessPropertiesByDotNotation: false, clearInvalidConfig: false })
}

export class SettingsStore {
  private constructor(private backend: SettingsBackend) {}
  static async open(directory: string, factory: SettingsBackendFactory = electronSettings): Promise<SettingsStore> {
    return new SettingsStore(await factory(directory))
  }
  static unavailable(reason: string): SettingsStore {
    return new SettingsStore({ get store() { return { ...emptySettings() } }, set store(_value) { throw new Error(reason) } })
  }
  read(): SettingsData { return parseSettings(structuredClone(this.backend.store)) }
  async replace(data: SettingsData): Promise<void> {
    this.backend.store = { ...parseSettings(data) }
  }
}
