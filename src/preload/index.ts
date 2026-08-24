import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type DateRange,
  type HdcExecResult,
  type HdcStreamEventPayload,
  type MoveResult,
  type Video,
  type WriteFileResult
} from '../shared/ipc'

export interface ElectronAPI {
  file: {
    scanVideos: (sourceDir: string, dateRange: DateRange | null) => Promise<Video[]>
    moveVideos: (videos: Video[], targetDir: string) => Promise<MoveResult>
    writeText: (filePath: string, content: string) => Promise<WriteFileResult>
  }
  selectFolder: () => Promise<string | null>
  hdc: {
    exec: (args: string[]) => Promise<HdcExecResult>
    listBundles: () => Promise<string[]>
    getForeground: () => Promise<string | null>
    streamStart: (args: string[]) => Promise<{ streamId: string }>
    streamStop: (streamId: string) => Promise<{ ok: boolean }>
    onStreamEvent: (cb: (payload: HdcStreamEventPayload) => void) => () => void
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  chrome: {
    detect: () => Promise<string | null>
    launch: (chromePath: string, url: string) => Promise<void>
  }
}

const api: ElectronAPI = {
  file: {
    scanVideos: (sourceDir, dateRange) =>
      ipcRenderer.invoke(IpcChannels.FileScanVideos, sourceDir, dateRange) as Promise<Video[]>,
    moveVideos: (videos, targetDir) =>
      ipcRenderer.invoke(IpcChannels.FileMoveVideos, videos, targetDir) as Promise<MoveResult>,
    writeText: (filePath, content) =>
      ipcRenderer.invoke(IpcChannels.FileWriteText, filePath, content) as Promise<WriteFileResult>
  },
  selectFolder: () => ipcRenderer.invoke(IpcChannels.DialogSelectFolder) as Promise<string | null>,
  hdc: {
    exec: (args) => ipcRenderer.invoke(IpcChannels.HdcExec, args) as Promise<HdcExecResult>,
    listBundles: () =>
      ipcRenderer.invoke(IpcChannels.HdcListBundles) as Promise<string[]>,
    getForeground: () =>
      ipcRenderer.invoke(IpcChannels.HdcGetForeground) as Promise<string | null>,
    streamStart: (args) =>
      ipcRenderer.invoke(IpcChannels.HdcStreamStart, args) as Promise<{ streamId: string }>,
    streamStop: (streamId) =>
      ipcRenderer.invoke(IpcChannels.HdcStreamStop, streamId) as Promise<{ ok: boolean }>,
    onStreamEvent: (cb) => {
      const listener = (
        _: unknown,
        payload: HdcStreamEventPayload
      ): void => cb(payload)
      ipcRenderer.on(IpcChannels.HdcStreamEvent, listener)
      return () => ipcRenderer.removeListener(IpcChannels.HdcStreamEvent, listener)
    }
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.ShellOpenExternal, url) as Promise<void>
  },
  chrome: {
    detect: () => ipcRenderer.invoke(IpcChannels.ChromeDetect) as Promise<string | null>,
    launch: (chromePath, url) =>
      ipcRenderer.invoke(IpcChannels.ChromeLaunch, chromePath, url) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('api', api)