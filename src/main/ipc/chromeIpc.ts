import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import { detectChromePath, launchChrome } from '../services/chromeService'

export function registerChromeIpc(): void {
  ipcMain.handle(IpcChannels.ChromeDetect, async (): Promise<string | null> => {
    return detectChromePath()
  })

  ipcMain.handle(
    IpcChannels.ChromeLaunch,
    async (_event, chromePath: string, url: string): Promise<void> => {
      await launchChrome(chromePath, url)
    }
  )
}
