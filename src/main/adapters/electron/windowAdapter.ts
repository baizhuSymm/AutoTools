import { app, BrowserWindow, shell, type IpcMainInvokeEvent } from 'electron'

interface WindowOptions {
  preloadPath: string
  rendererURL: string
  icon: string
}

export class WindowAdapter {
  private mainWindow: BrowserWindow | null = null
  constructor(private options: WindowOptions) {
    app.on('browser-window-created', (_, window) => {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.code === 'F12') {
          if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
          else window.webContents.openDevTools({ mode: 'undocked' })
          event.preventDefault()
        }
        if (app.isPackaged && input.code === 'KeyR' && (input.control || input.meta))
          event.preventDefault()
      })
    })
  }
  create(): void {
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 700,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      title: 'AutoTools',
      icon: this.options.icon,
      webPreferences: { preload: this.options.preloadPath, sandbox: false }
    })
    this.mainWindow = window
    window.on('ready-to-show', () => window.show())
    window.webContents.setWindowOpenHandler((details) => {
      if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (url.split('#')[0] !== this.options.rendererURL.split('#')[0]) event.preventDefault()
    })
    void window.loadURL(this.options.rendererURL)
    window.on('closed', () => {
      if (this.mainWindow === window) this.mainWindow = null
    })
  }
  isTrusted(event: IpcMainInvokeEvent): boolean {
    return Boolean(
      this.mainWindow &&
      event.sender === this.mainWindow.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.url.split('#')[0] === this.options.rendererURL.split('#')[0]
    )
  }
  hasWindow(): boolean {
    return BrowserWindow.getAllWindows().length > 0
  }
}
