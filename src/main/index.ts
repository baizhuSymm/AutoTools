import { BrowserWindow, app, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/AppIcon.png?asset'
import { registerFileIpc } from './ipc/fileIpc'
import { registerHdcIpc } from './ipc/hdcIpc'
import { registerChromeIpc } from './ipc/chromeIpc'

let mainWindow: BrowserWindow | null = null

function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function getRendererURL(): string {
  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return process.env['ELECTRON_RENDERER_URL']
  }
  return join(__dirname, '../renderer/index.html')
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.loadURL(getRendererURL())

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
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

  registerFileIpc()
  registerHdcIpc()
  registerChromeIpc()
  console.log('[main] ipc handlers registered')
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
