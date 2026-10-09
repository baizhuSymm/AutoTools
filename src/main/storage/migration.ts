import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { AgentDatabase } from './agentDatabase'
import { SettingsStore, emptySettings, type SettingsBackendFactory } from './settingsStore'
import { parseAgentData, parseLegacy, parseSettings, type SettingsData } from './schema'

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

export async function prepareStorage(directory: string, settingsFactory?: SettingsBackendFactory): Promise<{ database: AgentDatabase; settings: SettingsStore; warnings: string[] }> {
  await mkdir(directory, { recursive: true })
  const sourcePath = join(directory, 'agent-state.json')
  const backupPath = `${sourcePath}.pre-layering.bak`
  const dataPath = join(directory, 'agent-data.json')
  const settingsPath = join(directory, 'agent-settings.json')
  try {
    const rawSettings = await optionalFile(settingsPath)
    const prior = rawSettings ? parseSettings(JSON.parse(rawSettings.toString('utf8'))) : undefined
    if (prior?.migration) {
      const data = await optionalFile(dataPath)
      if (!data) throw new Error('迁移完成后的业务记录缺失，请从备份恢复')
      parseAgentData(JSON.parse(data.toString('utf8')))
      return { database: await AgentDatabase.open(directory), settings: await SettingsStore.open(directory, settingsFactory), warnings: [] }
    }
    const source = await optionalFile(sourcePath)
    const backup = await optionalFile(backupPath)
    const partial = Boolean(rawSettings || await optionalFile(dataPath))
    if (source) {
      if (backup && !source.equals(backup)) throw new Error('迁移源与备份不一致，请人工检查')
      if (!backup) await copyFile(sourcePath, backupPath, constants.COPYFILE_EXCL)
      const legacy = parseLegacy(JSON.parse(source.toString('utf8')))
      const database = await AgentDatabase.open(directory)
      database.update((data) => Object.assign(data, parseAgentData(legacy)))
      await database.commit()
      const settings = await SettingsStore.open(directory, settingsFactory)
      const target: SettingsData = { version: 1, config: legacy.config, encryptedKey: legacy.encryptedKey }
      await settings.replace(target)
      parseSettings(JSON.parse((await readFile(settingsPath)).toString('utf8')))
      parseAgentData(JSON.parse((await readFile(dataPath)).toString('utf8')))
      await settings.replace({ ...target, migration: { kind: 'legacy', sourceHash: createHash('sha256').update(source).digest('hex'), backupPath } })
      return { database, settings, warnings: [] }
    }
    if (partial || backup) throw new Error('存在未完成迁移记录但没有有效旧数据，未覆盖文件')
    const database = await AgentDatabase.open(directory)
    await database.commit()
    const settings = await SettingsStore.open(directory, settingsFactory)
    await settings.replace({ ...emptySettings(), migration: { kind: 'fresh' } })
    return { database, settings, warnings: [] }
  } catch (error) {
    const message = `本地记录无法读取或迁移，请检查原件与备份：${error instanceof Error ? error.message : String(error)}`
    return { database: AgentDatabase.unavailable(message), settings: SettingsStore.unavailable(message), warnings: [message] }
  }
}
