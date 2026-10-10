import { ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import * as schemas from './schemas'
import { AgentChannels } from '../../shared/agent'
import { IpcChannels } from '../../shared/ipc'
import type { ApplicationServices } from '../contracts/application'

interface IpcPlatform {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
}

export function registerAgentIpc(
  services: ApplicationServices,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  platform: IpcPlatform = { ipcMain }
): () => void {
  const registered: string[] = []
  const handle = (channel: string, callback: (...args: unknown[]) => unknown): void => {
    platform.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('不允许的 IPC 来源')
      return callback(...args)
    })
    registered.push(channel)
  }
  handle(AgentChannels.Snapshot, () => services.snapshots.snapshot())
  handle(AgentChannels.Create, () => services.sessions.create())
  handle(AgentChannels.Delete, (value) => services.chat.deleteSession(schemas.id.parse(value)))
  handle(AgentChannels.Send, (sessionId, text) =>
    services.chat.send(schemas.id.parse(sessionId), schemas.messageText.parse(text))
  )
  handle(AgentChannels.Cancel, () => services.chat.cancel())
  handle(AgentChannels.Confirm, (value, approved) =>
    services.tools.confirm(schemas.id.parse(value), schemas.approved.parse(approved))
  )
  handle(AgentChannels.Execute, (name, input) =>
    services.tools.execute(schemas.toolName.parse(name), schemas.toolInput.parse(input))
  )
  handle(AgentChannels.SaveConfig, (input) =>
    services.config.save(schemas.modelConfig.parse(input))
  )
  handle(AgentChannels.Test, () => services.config.testConnection())
  handle(IpcChannels.DialogSelectFolder, () => services.workspace.selectFolder())
  return () => {
    for (const channel of registered) platform.ipcMain.removeHandler(channel)
  }
}
