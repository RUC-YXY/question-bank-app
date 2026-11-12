import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/types'
import type {
  AppConfig,
  CapturePayload,
  DbChangedPayload,
  OverlayPayload,
  Question,
  QuestionFilter,
  SelectionRect,
  WindowApi
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: WindowApi = {
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet) as Promise<AppConfig>,
    set: (patch) => ipcRenderer.invoke(IPC.configSet, patch) as Promise<AppConfig>
  },
  dialog: {
    pickDocument: () => ipcRenderer.invoke(IPC.dialogPickDocument)
  },
  doc: {
    openViewer: (path) => ipcRenderer.invoke(IPC.docOpenViewer, path) as Promise<void>,
    touch: (path) => ipcRenderer.invoke(IPC.docTouch, path) as Promise<void>,
    recent: () => ipcRenderer.invoke(IPC.docRecent),
    viewerDocument: () => ipcRenderer.invoke(IPC.docViewerDocument),
    readFile: (path) => ipcRenderer.invoke(IPC.docReadFile, path) as Promise<Uint8Array>
  },
  capture: {
    start: (targetQuestionId?: string) =>
      ipcRenderer.invoke(IPC.captureStart, targetQuestionId) as Promise<void>,
    onResult: (cb) => subscribe<CapturePayload>(IPC.captureResult, cb),
    onError: (cb) => subscribe<string>(IPC.captureError, cb),
    overlayPayload: () => ipcRenderer.invoke(IPC.captureOverlayPayload) as Promise<OverlayPayload | null>,
    selected: (rect: SelectionRect) => ipcRenderer.send(IPC.captureSelected, rect),
    cancel: () => ipcRenderer.send(IPC.captureCancel)
  },
  vision: {
    recognizeQuestion: (questionId) =>
      ipcRenderer.invoke(IPC.visionRecognizeQuestion, questionId) as Promise<{
        questions: number
        warnings: string[]
      }>
  },
  files: {
    // 渲染进程拿不到 File.path，必须由 preload 侧的 webUtils 转成本地路径
    getPath: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  question: {
    list: (filter: QuestionFilter) => ipcRenderer.invoke(IPC.questionList, filter),
    get: (id) => ipcRenderer.invoke(IPC.questionGet, id),
    save: (draft) => ipcRenderer.invoke(IPC.questionSave, draft) as Promise<Question>,
    update: (id, patch) => ipcRenderer.invoke(IPC.questionUpdate, id, patch) as Promise<Question>,
    delete: (id) => ipcRenderer.invoke(IPC.questionDelete, id) as Promise<void>,
    facets: () => ipcRenderer.invoke(IPC.questionFacets),
    onOpen: (cb) => subscribe<string>(IPC.questionOpen, cb)
  },
  category: {
    create: (name) => ipcRenderer.invoke(IPC.categoryCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.categoryRename, id, name) as Promise<void>,
    delete: (id) => ipcRenderer.invoke(IPC.categoryDelete, id) as Promise<void>
  },
  kp: {
    create: (name) => ipcRenderer.invoke(IPC.kpCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.kpRename, id, name) as Promise<void>,
    delete: (id) => ipcRenderer.invoke(IPC.kpDelete, id) as Promise<void>
  },
  shell: {
    showInFolder: (path) => ipcRenderer.invoke(IPC.shellShowInFolder, path) as Promise<void>,
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url) as Promise<void>
  },
  app: {
    openSettings: () => ipcRenderer.invoke(IPC.appOpenSettings) as Promise<void>,
    openMain: () => ipcRenderer.invoke(IPC.appOpenMain) as Promise<void>,
    focusQuestion: (id) => ipcRenderer.invoke(IPC.appFocusQuestion, id) as Promise<void>
  },
  library: {
    exportQuestions: (ids, format) =>
      ipcRenderer.invoke(IPC.questionExport, ids, format) as Promise<string | null>
  },
  db: {
    onChanged: (cb) => subscribe<DbChangedPayload>(IPC.dbChanged, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
