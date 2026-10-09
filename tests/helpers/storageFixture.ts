import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsBackendFactory } from '../../src/main/storage/settingsStore'

// 纯 Node 测试替身；Electron smoke 另行验证真实 electron-store。
export const fileSettings: SettingsBackendFactory = async (directory) => {
  const path = join(directory, 'agent-settings.json')
  let data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  return {
    get store() {
      return structuredClone(data)
    },
    set store(value) {
      writeFileSync(path, JSON.stringify(value))
      data = structuredClone(value)
    }
  }
}
