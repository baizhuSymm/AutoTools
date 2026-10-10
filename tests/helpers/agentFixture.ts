import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { AppSnapshot, ModelConfig } from '../../src/shared/agent'
import type { ModelAdapter, SecretVault } from '../../src/main/contracts/agent'
import type { ModelProbe } from '../../src/main/services/modelConfigService'
import { createApplication } from '../../src/main/bootstrap/createApplication'
import type { ToolExecutor } from '../../src/main/services/tools/executor'
import { fileSettings } from './storageFixture'

export function testFiles(path: string) {
  const directory = dirname(path)
  return {
    directory,
    path: join(directory, 'agent-data.json'),
    async load<T>(fallback: T): Promise<T> {
      try {
        return JSON.parse(await readFile(join(directory, 'agent-data.json'), 'utf8')) as T
      } catch {
        return fallback
      }
    }
  }
}

export async function createTestAgent(
  files: ReturnType<typeof testFiles>,
  executor: ToolExecutor,
  modelFactory: (config: ModelConfig, key: string) => ModelAdapter,
  vault: SecretVault,
  publish: (snapshot: AppSnapshot) => void
) {
  let probe: ModelProbe = async () => ({ text: true, streaming: true, tools: true })
  const application = await createApplication({
    userData: files.directory,
    executor,
    modelFactory,
    vault,
    publish,
    settingsFactory: fileSettings,
    probe: (config, key) => probe(config, key)
  })
  return {
    ...application,
    probeModel: (value: ModelProbe) => {
      probe = value
      return application.services.config.testConnection()
    }
  }
}
