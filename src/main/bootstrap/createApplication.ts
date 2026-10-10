import { HdcAdapter } from '../adapters/device/hdcAdapter'
import { ChromeAdapter } from '../adapters/browser/chromeAdapter'
import { ExternalLinkAdapter } from '../adapters/electron/externalLinkAdapter'
import { DeviceService } from '../services/deviceService'
import { WebviewService } from '../services/webviewService'
import { VideoService } from '../services/videoService'
import { FileSystemAdapter } from '../adapters/filesystem/fileSystemAdapter'
import type { AppSnapshot, ModelConfig } from '../../shared/agent'
import type { ModelAdapter, SecretVault } from '../contracts/agent'
import { AgentRunner } from '../agent/runner'
import { prepareStorage } from '../storage/migration'
import { recoverAgentData } from '../storage/recovery'
import type { SettingsBackendFactory } from '../storage/settingsStore'
import { PersistenceCoordinator } from '../storage/persistenceCoordinator'
import { SessionRepository } from '../repositories/sessionRepository'
import { ConfigRepository } from '../repositories/configRepository'
import { ExecutionRepository } from '../repositories/executionRepository'
import { SessionService } from '../services/sessionService'
import { ChatService } from '../services/chatService'
import { ModelConfigService, type ModelProbe } from '../services/modelConfigService'
import { ToolService } from '../services/toolService'
import { SnapshotService } from '../services/snapshotService'
import { ToolExecutor } from '../services/tools/executor'
import { createRegistry } from '../services/tools/registry'

export interface ApplicationServices {
  sessions: SessionService
  chat: ChatService
  config: ModelConfigService
  tools: ToolService
  snapshots: SnapshotService
}
export interface ApplicationOptions {
  userData: string
  vault: SecretVault
  modelFactory: (config: ModelConfig, key: string) => ModelAdapter
  probe: ModelProbe
  publish: (snapshot: AppSnapshot) => void
  settingsFactory?: SettingsBackendFactory
  executor?: ToolExecutor
  diagnose?: (message: string) => void
}

export async function createApplication(
  options: ApplicationOptions
): Promise<{ services: ApplicationServices; shutdown(): Promise<void> }> {
  const storage = await prepareStorage(options.userData, options.settingsFactory)
  storage.database.update((data) => Object.assign(data, recoverAgentData(data)))
  let warning = storage.warnings.join('\n') || undefined
  const notification: { snapshots?: SnapshotService } = {}
  let closing = false
  const changed = (): void => notification.snapshots?.changed()
  const executions = new ExecutionRepository(storage.database)
  const persistence = new PersistenceCoordinator(storage.database, (error) => {
    warning = config.sanitize(error)
    changed()
  })
  const sessions = new SessionService(
    new SessionRepository(storage.database),
    executions,
    persistence,
    changed
  )
  const config: ModelConfigService = new ModelConfigService(
    new ConfigRepository(storage.settings),
    options.vault,
    options.probe,
    (): boolean => closing || chat.activeSessionId() !== null,
    changed
  )
  const hdc = new HdcAdapter()
  const devices = new DeviceService(hdc)
  const webview = new WebviewService(devices, hdc, new ChromeAdapter(), new ExternalLinkAdapter())
  const tools = new ToolService(
    options.executor ??
      new ToolExecutor(
        createRegistry({ video: new VideoService(new FileSystemAdapter()), devices, webview })
      ),
    executions,
    persistence,
    changed
  )
  const chat: ChatService = new ChatService(
    sessions,
    config,
    tools,
    new AgentRunner(),
    options.modelFactory,
    persistence,
    changed
  )
  config.initialize()
  const snapshots = new SnapshotService(
    {
      conversations: () => sessions.list(),
      calls: () => tools.calls(),
      config: () => config.snapshot(),
      activeSessionId: () => chat.activeSessionId(),
      warning: () => warning ?? config.warning
    },
    options.publish
  )
  notification.snapshots = snapshots
  let shutdownRun: Promise<void> | undefined
  const services = { sessions, config, tools, chat, snapshots }
  return {
    services,
    shutdown: () => {
      if (shutdownRun) return shutdownRun
      closing = true
      sessions.close()
      shutdownRun = (async () => {
        const failures: unknown[] = []
        const invoke = async (operation: () => Promise<unknown>): Promise<void> => {
          try {
            await operation()
          } catch (error) {
            failures.push(error)
          }
        }
        try {
          const results = await Promise.allSettled([chat.close(), tools.close()])
          for (const result of results)
            if (result.status === 'rejected') failures.push(result.reason)
          await invoke(() => persistence.commit())
          await invoke(() => persistence.flush())
        } finally {
          persistence.dispose()
          services.snapshots.dispose()
        }
        if (failures.length) {
          const message = failures.map((error) => config.sanitize(error)).join('\n')
          options.diagnose?.(message)
          throw new Error(`应用退出时发生错误：${message}`)
        }
      })()
      return shutdownRun
    }
  }
}
