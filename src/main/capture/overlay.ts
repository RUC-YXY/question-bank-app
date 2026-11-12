import { BrowserWindow, ipcMain } from 'electron'
import type { Display } from 'electron'
import { IPC } from '@shared/types'
import type { OverlayPayload, SelectionRect } from '@shared/types'

let overlayPayload: OverlayPayload | null = null

export function currentOverlayPayload(): OverlayPayload | null {
  return overlayPayload
}

/**
 * 全屏遮罩窗口：铺在目标屏幕上，显示冻结的截图，等用户拖框。
 * 返回选区（CSS 坐标），取消或关窗返回 null。
 */
export function showOverlay(opts: {
  display: Display
  payload: OverlayPayload
  preload: string
  url: string
}): Promise<SelectionRect | null> {
  const { display, payload, preload, url } = opts
  overlayPayload = payload

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  return new Promise<SelectionRect | null>((resolve) => {
    let settled = false

    const cleanup = (): void => {
      ipcMain.removeListener(IPC.captureSelected, onSelected)
      ipcMain.removeListener(IPC.captureCancel, onCancel)
    }

    const finish = (rect: SelectionRect | null): void => {
      if (settled) return
      settled = true
      cleanup()
      overlayPayload = null
      if (!win.isDestroyed()) win.close()
      resolve(rect)
    }

    const onSelected = (event: Electron.IpcMainEvent, rect: SelectionRect): void => {
      if (event.sender !== win.webContents) return
      finish(rect)
    }
    const onCancel = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== win.webContents) return
      finish(null)
    }

    ipcMain.on(IPC.captureSelected, onSelected)
    ipcMain.on(IPC.captureCancel, onCancel)
    win.on('closed', () => finish(null))

    win.webContents.once('did-finish-load', () => {
      win.show()
      win.focus()
    })

    void win.loadURL(url)
  })
}
