import { contextBridge, ipcRenderer } from 'electron'
import { AgentChannels, type AgentAPI, type AppSnapshot } from '../shared/agent'
import { IpcChannels } from '../shared/ipc'

export interface ElectronAPI {
  agent: AgentAPI
  selectFolder: () => Promise<string | null>
}

const api: ElectronAPI = {
  agent: {
    snapshot: () => ipcRenderer.invoke(AgentChannels.Snapshot),
    createSession: () => ipcRenderer.invoke(AgentChannels.Create),
    deleteSession: (id) => ipcRenderer.invoke(AgentChannels.Delete, id),
    send: (id, text) => ipcRenderer.invoke(AgentChannels.Send, id, text),
    cancel: () => ipcRenderer.invoke(AgentChannels.Cancel),
    confirm: (id, approved) => ipcRenderer.invoke(AgentChannels.Confirm, id, approved),
    execute: (name, input) => ipcRenderer.invoke(AgentChannels.Execute, name, input),
    saveConfig: (input) => ipcRenderer.invoke(AgentChannels.SaveConfig, input),
    testConnection: () => ipcRenderer.invoke(AgentChannels.Test),
    onSnapshot: (callback) => {
      const listener = (_: unknown, snapshot: AppSnapshot): void => callback(snapshot)
      ipcRenderer.on(AgentChannels.Event, listener)
      return () => {
        ipcRenderer.removeListener(AgentChannels.Event, listener)
      }
    }
  },
  selectFolder: () => ipcRenderer.invoke(IpcChannels.DialogSelectFolder)
}

contextBridge.exposeInMainWorld('api', api)
