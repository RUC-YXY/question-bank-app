import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { ViewerDocument } from '@shared/types'

const preloadPath = (): string => join(__dirname, '../preload/index.js')

/** 窗口与任务栏图标：开发时读项目 resources/，打包后读 extraResources 复制过去的那份 */
function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

/** 开发时用 dev server，打包后用本地 html */
export function rendererUrl(page: 'index' | 'viewer' | 'overlay' | 'settings'): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const base = devUrl.replace(/\/+$/, '')
    return `${base}/${page}.html`
  }
  return `file://${join(__dirname, `../renderer/${page}.html`).replace(/\\/g, '/')}`
}

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current) event.preventDefault()
  })
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f6f8',
    title: '题库本',
    icon: appIconPath(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  harden(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  void mainWindow.loadURL(rendererUrl('index'))
  return mainWindow
}

/** viewer 窗口 → 文档的映射，页面通过 IPC 反查自己该开哪份文档 */
export const viewerDocs = new Map<number, ViewerDocument>()

export function createViewerWindow(doc: ViewerDocument): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#ffffff',
    title: `${doc.path.split(/[\\/]/).pop() ?? '文档'} - 题库本`,
    icon: appIconPath(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  harden(win)
  const webContentsId = win.webContents.id
  viewerDocs.set(webContentsId, doc)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => viewerDocs.delete(webContentsId))
  void win.loadURL(rendererUrl('viewer'))
  return win
}

let settingsWindow: BrowserWindow | null = null

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 700,
    minWidth: 640,
    minHeight: 560,
    show: false,
    backgroundColor: '#f5f6f8',
    title: '设置 - 题库本',
    icon: appIconPath(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  harden(settingsWindow)
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  void settingsWindow.loadURL(rendererUrl('settings'))
  return settingsWindow
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createMainWindow()
  }
}
