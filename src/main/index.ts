import { WindowAdapter } from './adapters/electron/windowAdapter'
import { FileSystemAdapter } from './adapters/filesystem/fileSystemAdapter'
import { HdcAdapter } from './adapters/device/hdcAdapter'
import { ChromeAdapter } from './adapters/browser/chromeAdapter'
import { ExternalLinkAdapter } from './adapters/electron/externalLinkAdapter'
import { DialogAdapter } from './adapters/electron/dialogAdapter'
import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/AppIcon.png?asset'
import { registerAgentIpc } from './ipc/agentIpc'
import { createApplication } from './bootstrap/createApplication'
import { createSecretVault } from './adapters/electron/secretVault'
import { createSnapshotPublisher } from './adapters/electron/snapshotPublisher'
import { createModel, testModel } from './adapters/model/langchainAdapter'

app.setName('AutoTools')
if (process.env['AUTOTOOLS_USER_DATA']) app.setPath('userData', process.env['AUTOTOOLS_USER_DATA'])

let shutdown: (() => Promise<void>) | undefined
let exiting = false
function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js')
}
function getRendererURL(): string {
  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return new URL(process.env['ELECTRON_RENDERER_URL']).href
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}
app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? 'com.electron.auto-tools' : process.execPath)
  }
  const windows = new WindowAdapter({
    preloadPath: getPreloadPath(),
    rendererURL: getRendererURL(),
    icon
  })
  const application = await createApplication({
    userData: app.getPath('userData'),
    files: new FileSystemAdapter(),
    hdc: new HdcAdapter(),
    chrome: new ChromeAdapter(),
    external: new ExternalLinkAdapter(),
    dialog: new DialogAdapter(),
    vault: createSecretVault(),
    modelFactory: createModel,
    probe: testModel,
    publish: createSnapshotPublisher(),
    diagnose: (message) => console.error(message)
  })
  const unregister = registerAgentIpc(application.services, (event) => windows.isTrusted(event))
  shutdown = async () => {
    unregister()
    await application.shutdown()
  }
  console.log('[main] ipc handlers registered')
  windows.create()
  app.on('activate', () => {
    if (!windows.hasWindow()) windows.create()
  })
})
app.on('before-quit', (event) => {
  if (exiting || !shutdown) return
  event.preventDefault()
  exiting = true
  void shutdown()
    .catch((error: unknown) =>
      console.error(error instanceof Error ? error.message : '应用退出失败')
    )
    .finally(() => app.quit())
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
