import { dialog, ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { AgentChannels } from '../../shared/agent'
import { IpcChannels } from '../../shared/ipc'
import type { ApplicationServices } from '../bootstrap/createApplication'

interface IpcPlatform {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  selectFolder: () => Promise<string | null>
}

export function registerAgentIpc(
  services: ApplicationServices,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  platform: IpcPlatform = {
    ipcMain,
    selectFolder: async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  }
): () => void {
  const registered: string[] = []
  const handle = (channel: string, callback: (...args: unknown[]) => unknown): void => {
    platform.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('不允许的 IPC 来源')
      return callback(...args)
    })
    registered.push(channel)
  }
  const id = z.string().uuid()
  handle(AgentChannels.Snapshot, () => services.snapshots.snapshot())
  handle(AgentChannels.Create, () => services.sessions.create())
  handle(AgentChannels.Delete, (value) => services.chat.deleteSession(id.parse(value)))
  handle(AgentChannels.Send, (sessionId, text) =>
    services.chat.send(id.parse(sessionId), z.string().min(1).max(65536).parse(text))
  )
  handle(AgentChannels.Cancel, () => services.chat.cancel())
  handle(AgentChannels.Confirm, (value, approved) =>
    services.tools.confirm(id.parse(value), z.boolean().parse(approved))
  )
  handle(AgentChannels.Execute, (name, input) =>
    services.tools.execute(
      z.string().min(1).max(80).parse(name),
      z.record(z.string(), z.unknown()).parse(input)
    )
  )
  handle(AgentChannels.SaveConfig, (input) =>
    services.config.save(
      z.object({ baseURL: z.string(), model: z.string(), key: z.string().optional() }).parse(input)
    )
  )
  handle(AgentChannels.Test, () => services.config.testConnection())
  handle(IpcChannels.DialogSelectFolder, () => platform.selectFolder())
  return () => {
    for (const channel of registered) platform.ipcMain.removeHandler(channel)
  }
}
