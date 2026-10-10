import type { ApplicationServices } from '../contracts/application'
import type {
  FileSystemPort,
  HdcPort,
  ChromePort,
  ExternalLinkPort,
  FolderDialogPort
} from '../contracts/ports'
import { WorkspaceService } from '../services/workspaceService'
import { DeviceService } from '../services/deviceService'
import { WebviewService } from '../services/webviewService'
import { VideoService } from '../services/videoService'
import type { AppSnapshot, ModelConfig } from '../../shared/agent'
import type { ModelAdapter, SecretVault, ModelProbe } from '../contracts/agent'
import { AgentRunner } from '../services/agent/runner'
import { prepareStorage } from '../adapters/storage/migration'
import { recoverAgentData } from '../services/agent/recovery'
import type { SettingsBackendFactory } from '../adapters/storage/settingsStore'
import { PersistenceCoordinator } from '../adapters/storage/persistenceCoordinator'
import { SessionRepository } from '../adapters/storage/repositories/sessionRepository'
import { ConfigRepository } from '../adapters/storage/repositories/configRepository'
import { ExecutionRepository } from '../adapters/storage/repositories/executionRepository'
import { SessionService } from '../services/agent/sessionService'
import { ChatService } from '../services/agent/chatService'
import { ModelConfigService } from '../services/agent/modelConfigService'
import { ToolService } from '../services/tools/toolService'
import { SnapshotService } from '../services/agent/snapshotService'
import { ToolExecutor } from '../services/tools/executor'
import { createRegistry } from '../services/tools/registry'

interface ComposedServices extends ApplicationServices {
  sessions: SessionService
  chat: ChatService
  config: ModelConfigService
  tools: ToolService
  snapshots: SnapshotService
  workspace: WorkspaceService
}
export interface ApplicationOptions {
  userData: string
  files: FileSystemPort
  hdc: HdcPort
  chrome: ChromePort
  external: ExternalLinkPort
  dialog: FolderDialogPort
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
): Promise<{ services: ComposedServices; shutdown(): Promise<void> }> {
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
  const devices = new DeviceService(options.hdc)
  const webview = new WebviewService(devices, options.hdc, options.chrome, options.external)
  const video = new VideoService(options.files)
  const workspace = new WorkspaceService(options.dialog)
  const tools = new ToolService(
    options.executor ?? new ToolExecutor(createRegistry({ video, devices, webview })),
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
  const services = { sessions, config, tools, chat, snapshots, workspace }
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
