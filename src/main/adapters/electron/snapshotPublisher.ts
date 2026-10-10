import { BrowserWindow } from 'electron'
import { AgentChannels, type AppSnapshot } from '../../../shared/agent'

export function createSnapshotPublisher(): (snapshot: AppSnapshot) => void {
  return (snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(AgentChannels.Event, snapshot)
    }
  }
}
