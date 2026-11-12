import { app, BrowserWindow, Menu, net, protocol } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DbChangedPayload } from '@shared/types'
import { IPC } from '@shared/types'
import { getConfig, touchRecentDoc } from './config'
import { registerShortcut, unregisterShortcut } from './capture/shortcut'
import { registerIpc, runCapture } from './ipc'
import type { IpcDeps } from './ipc'
import { dataDir } from './store/paths'
import { Store } from './store/store'
import {
  createMainWindow,
  createSettingsWindow,
  createViewerWindow,
  getMainWindow,
  showMainWindow
} from './windows'

// 必须在 ready 之前注册；tikuben://img/<相对路径> 用于渲染进程显示截图
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tikuben',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function broadcast(scope: DbChangedPayload['scope']): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.dbChanged, { scope })
  }
}

function registerImageProtocol(): void {
  protocol.handle('tikuben', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'img') return new Response('not found', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = resolve(dataDir())
    const abs = resolve(root, rel)
    // 防目录穿越
    if (abs !== root && !abs.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(abs).toString())
  })
}

async function openDocumentByDialog(): Promise<void> {
  const { dialog } = await import('electron')
  const parent = getMainWindow()
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        title: '选择要阅读的文档',
        properties: ['openFile'],
        filters: [{ name: '文档', extensions: ['pdf', 'docx'] }]
      })
    : await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '文档', extensions: ['pdf', 'docx'] }]
      })
  if (result.canceled || result.filePaths.length === 0) return
  const path = result.filePaths[0]
  const ext = extname(path).toLowerCase()
  if (ext !== '.pdf' && ext !== '.docx') return
  await touchRecentDoc(path)
  broadcast('config')
  createViewerWindow({ path, kind: ext === '.pdf' ? 'pdf' : 'docx' })
}

function buildMenu(shortcut: string, deps: IpcDeps): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '打开文档…', accelerator: 'CmdOrCtrl+O', click: () => void openDocumentByDialog() },
        { type: 'separator' },
        { label: '关闭窗口', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => createSettingsWindow() },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '操作',
      submenu: [
        {
          label: `截图识别（全局 ${shortcut}）`,
          click: () => void runCapture(deps)
        },
        { label: '回到主窗口', click: () => showMainWindow() }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.tikuben.app')

  const store = new Store(broadcast)
  await store.init()

  const cfg = await getConfig()

  let deps: IpcDeps
  const reloadShortcut = (accelerator: string): { ok: boolean; message?: string } =>
    registerShortcut(accelerator, () => void runCapture(deps))
  deps = { store, broadcast, reloadShortcut }

  registerImageProtocol()
  registerIpc(deps)

  createMainWindow()
  buildMenu(cfg.shortcut, deps)

  const registered = registerShortcut(cfg.shortcut, () => void runCapture(deps))
  if (!registered.ok) {
    console.warn('[题库本] 全局快捷键注册失败：', registered.message)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    void bootstrap()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    unregisterShortcut()
  })
}
