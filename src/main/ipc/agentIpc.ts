import { app, BrowserWindow, dialog, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { AgentChannels } from '../../shared/agent'
import { IpcChannels } from '../../shared/ipc'
import { AgentRuntime } from '../agent/runtime'
import { createModel, testModel } from '../agent/model'
import { JsonStore } from '../storage/store'
import { ToolExecutor } from '../tools/executor'
import { createRegistry } from '../tools/registry'
import { MonitorManager } from '../tasks/monitor'
import { spawnHdcStream } from '../services/hdcService'

export async function registerAgentIpc(trusted: (event: IpcMainInvokeEvent) => boolean): Promise<{
  runtime: AgentRuntime
  shutdown: () => Promise<void>
}> {
  const monitors = new MonitorManager(
    (deviceId) =>
      spawnHdcStream(['-t', deviceId, 'shell', 'hilog', '-T', 'faultlogger', '-T', 'AppMgr']),
    () => runtime.changed()
  )
  const executor = new ToolExecutor(createRegistry(monitors))
  const runtime = new AgentRuntime(
    new JsonStore(join(app.getPath('userData'), 'agent-state.json')),
    executor,
    createModel,
    {
      encrypt: (key) =>
        safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(key).toString('base64')
          : null,
      decrypt: (value) =>
        safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(value, 'base64'))
          : ''
    },
    (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(AgentChannels.Event, snapshot)
      }
    }
  )
  runtime.tasks = () => monitors.list()
  await runtime.init()
  const handle = (channel: string, callback: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('不允许的 IPC 来源')
      return callback(...args)
    })
  }
  const id = z.string().uuid()
  handle(AgentChannels.Snapshot, () => runtime.snapshot())
  handle(AgentChannels.Create, () => runtime.createSession())
  handle(AgentChannels.Delete, (value) => runtime.deleteSession(id.parse(value)))
  handle(AgentChannels.Send, (sessionId, text) =>
    runtime.send(id.parse(sessionId), z.string().min(1).max(65536).parse(text))
  )
  handle(AgentChannels.Cancel, () => runtime.cancel())
  handle(AgentChannels.Confirm, (value, approved) =>
    runtime.confirm(id.parse(value), z.boolean().parse(approved))
  )
  handle(AgentChannels.Execute, (name, input) =>
    runtime.execute(
      z.string().min(1).max(80).parse(name),
      z.record(z.string(), z.unknown()).parse(input)
    )
  )
  handle(AgentChannels.SaveConfig, (input) =>
    runtime.saveConfig(
      z
        .object({
          baseURL: z.string(),
          model: z.string(),
          key: z.string().optional()
        })
        .parse(input)
    )
  )
  handle(AgentChannels.Test, () => runtime.testConnection(testModel))
  handle(IpcChannels.DialogSelectFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  return {
    runtime,
    shutdown: async () => {
      await Promise.allSettled([runtime.shutdown(), monitors.shutdown()])
      await runtime.flush()
    }
  }
}
