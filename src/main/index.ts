import { BrowserWindow, app, shell } from 'electron'
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

let mainWindow: BrowserWindow | null = null
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
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'AutoTools',
    icon,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false
    }
  })
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== getRendererURL().split('#')[0]) event.preventDefault()
  })
  mainWindow.loadURL(getRendererURL())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}
app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? 'com.electron.auto-tools' : process.execPath)
  }
  // F12 切换 DevTools；打包后禁用 Ctrl+R 刷新
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.code === 'F12') {
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools()
        } else {
          window.webContents.openDevTools({ mode: 'undocked' })
        }
        event.preventDefault()
      }
      if (app.isPackaged && input.code === 'KeyR' && (input.control || input.meta)) {
        event.preventDefault()
      }
    })
  })
  const application = await createApplication({
    userData: app.getPath('userData'),
    vault: createSecretVault(),
    modelFactory: createModel,
    probe: testModel,
    publish: createSnapshotPublisher(),
    diagnose: (message) => console.error(message)
  })
  const unregister = registerAgentIpc(application.services, (event) =>
    Boolean(
      mainWindow &&
      event.sender === mainWindow.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.url.split('#')[0] === getRendererURL().split('#')[0]
    )
  )
  shutdown = async () => {
    unregister()
    await application.shutdown()
  }
  console.log('[main] ipc handlers registered')
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
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
