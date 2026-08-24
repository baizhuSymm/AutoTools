import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  IpcChannels,
  type HdcExecResult,
  type HdcStreamEventPayload
} from '../../shared/ipc'
import {
  execHdc,
  getForegroundBundle,
  listInstalledBundles,
  spawnHdcStream,
  type HdcStreamHandle
} from '../services/hdcService'

/** main 端维护的所有运行中的流,key = streamId */
const streams = new Map<string, HdcStreamHandle>()

function broadcast(window: BrowserWindow | null, payload: HdcStreamEventPayload): void {
  if (!window || window.isDestroyed()) return
  window.webContents.send(IpcChannels.HdcStreamEvent, payload)
}

export function registerHdcIpc(): void {
  ipcMain.handle(IpcChannels.HdcExec, async (_event, args: string[]): Promise<HdcExecResult> => {
    if (!Array.isArray(args)) {
      throw new Error('hdc:exec 需要 string[] 类型的参数')
    }
    return execHdc(args)
  })

  ipcMain.handle(IpcChannels.HdcListBundles, async (): Promise<string[]> => {
    return listInstalledBundles()
  })

  ipcMain.handle(IpcChannels.HdcGetForeground, async (): Promise<string | null> => {
    return getForegroundBundle()
  })

  ipcMain.handle(
    IpcChannels.HdcStreamStart,
    async (_event, args: string[]): Promise<{ streamId: string }> => {
      if (!Array.isArray(args)) {
        throw new Error('hdc:streamStart 需要 string[] 类型的参数')
      }
      const window = BrowserWindow.fromWebContents(_event.sender)
      const handle = spawnHdcStream(args)
      streams.set(handle.id, handle)

      handle.on('stdout', (chunk: string) => {
        broadcast(window, { type: 'stdout', streamId: handle.id, data: chunk })
      })
      handle.on('stderr', (chunk: string) => {
        broadcast(window, { type: 'stderr', streamId: handle.id, data: chunk })
      })
      handle.on('close', (code: number) => {
        broadcast(window, { type: 'close', streamId: handle.id, code })
        streams.delete(handle.id)
      })
      handle.on('error', (err: Error) => {
        broadcast(window, { type: 'error', streamId: handle.id, message: err.message })
        streams.delete(handle.id)
      })

      return { streamId: handle.id }
    }
  )

  ipcMain.handle(
    IpcChannels.HdcStreamStop,
    async (_event, streamId: string): Promise<{ ok: boolean }> => {
      if (typeof streamId !== 'string') {
        throw new Error('hdc:streamStop 需要 streamId 字符串')
      }
      const h = streams.get(streamId)
      if (!h) return { ok: false }
      await h.stop()
      streams.delete(streamId)
      return { ok: true }
    }
  )

  ipcMain.handle(IpcChannels.ShellOpenExternal, async (_event, url: string): Promise<void> => {
    if (typeof url !== 'string' || !url) {
      throw new Error('shell:openExternal 需要非空字符串 URL')
    }
    await shell.openExternal(url)
  })

  console.log(
    '[ipc] registered:',
    IpcChannels.HdcExec,
    IpcChannels.HdcListBundles,
    IpcChannels.HdcGetForeground,
    IpcChannels.HdcStreamStart,
    IpcChannels.HdcStreamStop,
    IpcChannels.ShellOpenExternal
  )
}