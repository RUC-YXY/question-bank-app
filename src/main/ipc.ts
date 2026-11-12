import { dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type {
  AppConfig,
  CapturePayload,
  DbChangedPayload,
  DraftQuestion,
  OverlayPayload,
  PickedDocument,
  Question,
  QuestionFilter,
  RawRecognizedQuestion,
  RecognitionResult,
  ViewerDocument
} from '@shared/types'
import { IPC } from '@shared/types'
import { getApiKey, getConfig, setConfig, touchRecentDoc } from './config'
import { buildDocx, buildMarkdown, buildPdf } from './export'
import {
  cropSelection,
  grabScreen,
  readImageBase64,
  saveCapture,
  toDataUrl
} from './capture/capture'
import { currentOverlayPayload, showOverlay } from './capture/overlay'
import { dataDir } from './store/paths'
import type { Store } from './store/store'
import { parseRecognition } from './vision/parse'
import { mockRecognition } from './vision/mock'
import { requestRecognition } from './vision/client'
import {
  createSettingsWindow,
  createViewerWindow,
  getMainWindow,
  rendererUrl,
  showMainWindow,
  viewerDocs
} from './windows'

export interface IpcDeps {
  store: Store
  broadcast: (scope: DbChangedPayload['scope']) => void
  reloadShortcut: (accelerator: string) => { ok: boolean; message?: string }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function toDraft(
  raw: RawRecognizedQuestion,
  imagePath: string | null,
  capturedAt: string,
  rawModelOutput = ''
): DraftQuestion {
  return {
    kind: 'wrong',
    questionType: raw.questionType,
    stem: raw.stem,
    options: raw.options,
    answer: raw.answer,
    analysis: raw.analysis,
    categoryId: null,
    knowledgeIds: [],
    source: { capturedAt },
    imagePaths: imagePath ? [imagePath] : [],
    rawModelOutput,
    confidence: raw.confidence,
    warnings: raw.warnings
  }
}

/** 真实识别或 mock，返回统一结构。多张图一起提交，模型会当作同一道题处理 */
async function recognizeImages(imageRelPaths: string[]): Promise<RecognitionResult> {
  const cfg = await getConfig()
  if (cfg.useMock || !cfg.hasApiKey) {
    return mockRecognition()
  }
  const images = await Promise.all(
    imageRelPaths.map(async (relPath) => {
      const { base64, mime } = await readImageBase64(join(dataDir(), relPath))
      return { base64, mime }
    })
  )
  const apiKey = await getApiKey()
  const resp = await requestRecognition({
    apiBaseUrl: cfg.apiBaseUrl,
    apiKey,
    model: cfg.apiModel,
    images
  })
  return parseRecognition(resp.content)
}

/** 把识别结果写回草稿；一张图多题时其余条目各建一条草稿 */
async function applyRecognition(
  store: Store,
  questionId: string,
  imageRelPath: string,
  result: RecognitionResult
): Promise<void> {
  const now = new Date().toISOString()

  if (result.questions.length === 0) {
    await store.patchInPlace(questionId, {
      warnings: [...result.warnings, '未识别到题目，请重新截图或手动录入'],
      confidence: 0,
      rawModelOutput: result.raw
    })
    return
  }

  const [first, ...rest] = result.questions
  await store.patchInPlace(questionId, {
    stem: first.stem,
    options: first.options,
    answer: first.answer,
    analysis: first.analysis,
    questionType: first.questionType,
    confidence: first.confidence,
    warnings: [...result.warnings, ...first.warnings],
    rawModelOutput: result.raw
  })

  for (const extra of rest) {
    const created = await store.createDraft({ imagePath: imageRelPath })
    await store.patchInPlace(created.id, {
      stem: extra.stem,
      options: extra.options,
      answer: extra.answer,
      analysis: extra.analysis,
      questionType: extra.questionType,
      confidence: extra.confidence,
      warnings: extra.warnings,
      rawModelOutput: result.raw,
      source: { capturedAt: now }
    })
  }
}

let capturing = false

export async function runCapture(deps: IpcDeps, targetQuestionId?: string): Promise<void> {
  if (capturing) return
  capturing = true
  const main = getMainWindow()

  try {
    // 不隐藏主窗口：阅读器已经嵌在主窗口里，隐藏之后就截不到窗口内的内容。
    // 遮罩是 alwaysOnTop 的全屏窗口，抓到的屏幕图会作为它的底图，视觉上相当于定格。
    const grab = await grabScreen()
    const payload: OverlayPayload = {
      screenshot: toDataUrl(grab.image),
      imageWidth: grab.image.getSize().width,
      imageHeight: grab.image.getSize().height
    }

    const rect = await showOverlay({
      display: grab.display,
      payload,
      preload: join(__dirname, '../preload/index.js'),
      url: rendererUrl('overlay')
    })

    if (!rect) return

    const cropped = cropSelection(grab.image, rect)
    const saved = await saveCapture(cropped)

    if (targetQuestionId) {
      // 追加到已有题目：只补一张图，不覆盖已有的识别结果
      await deps.store.appendImage(targetQuestionId, saved.relPath)
      const appendedPayload: CapturePayload = {
        questionId: targetQuestionId,
        imagePath: saved.relPath,
        width: saved.width,
        height: saved.height,
        appended: true
      }
      main?.webContents.send(IPC.captureResult, appendedPayload)
      return
    }

    const draft = await deps.store.createDraft({ imagePath: saved.relPath })

    const capturePayload: CapturePayload = {
      questionId: draft.id,
      imagePath: saved.relPath,
      width: saved.width,
      height: saved.height,
      appended: false
    }
    main?.webContents.send(IPC.captureResult, capturePayload)
  } catch (err) {
    getMainWindow()?.webContents.send(IPC.captureError, (err as Error).message)
  } finally {
    capturing = false
  }
}

export function registerIpc(deps: IpcDeps): void {
  // ── 配置 ──
  ipcMain.handle(IPC.configGet, () => getConfig())

  ipcMain.handle(IPC.configSet, async (_e, patch: Partial<AppConfig> & { apiKey?: string }) => {
    const before = await getConfig()
    const next = await setConfig(patch)
    if (patch.shortcut !== undefined && patch.shortcut !== before.shortcut) {
      const result = deps.reloadShortcut(next.shortcut)
      if (!result.ok) {
        // 注册失败：回滚到旧快捷键，避免用户失去截屏能力
        await setConfig({ shortcut: before.shortcut })
        deps.reloadShortcut(before.shortcut)
        throw new Error(result.message ?? '快捷键注册失败')
      }
    }
    deps.broadcast('config')
    return next
  })

  // ── 文档 ──
  ipcMain.handle(IPC.dialogPickDocument, async (): Promise<PickedDocument | null> => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择要阅读的文档',
          properties: ['openFile'],
          filters: [
            { name: '文档', extensions: ['pdf', 'docx'] }
          ]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: '文档', extensions: ['pdf', 'docx'] }]
        })

    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const ext = extname(path).toLowerCase()
    if (ext === '.doc') throw new Error('不支持 .doc 老格式，请另存为 .docx')
    if (ext !== '.pdf' && ext !== '.docx') throw new Error('只支持 PDF 与 DOCX')
    return { path, kind: ext === '.pdf' ? 'pdf' : 'docx' }
  })

  ipcMain.handle(IPC.docOpenViewer, async (_e, path: string) => {
    const ext = extname(path).toLowerCase()
    if (ext !== '.pdf' && ext !== '.docx') throw new Error('只支持 PDF 与 DOCX')
    await touchRecentDoc(path)
    deps.broadcast('config')
    createViewerWindow({ path, kind: ext === '.pdf' ? 'pdf' : 'docx' })
  })

  ipcMain.handle(IPC.docRecent, async () => (await getConfig()).recentDocs)

  // 只更新最近文档列表，不开窗口：主窗口内嵌阅读器走这条
  ipcMain.handle(IPC.docTouch, async (_e, path: string) => {
    await touchRecentDoc(path)
    deps.broadcast('config')
  })

  ipcMain.handle(IPC.docViewerDocument, (event): ViewerDocument | null => {
    return viewerDocs.get(event.sender.id) ?? null
  })

  ipcMain.handle(IPC.docReadFile, async (_e, path: string): Promise<Uint8Array> => {
    const buf = await fs.readFile(path)
    return new Uint8Array(buf)
  })

  // ── 截图 ──
  ipcMain.handle(IPC.captureStart, async (_e, targetQuestionId?: string) => {
    // 等这一轮截图结束（确认、取消或失败）再返回：renderer 靠它把收起的界面放回来
    await runCapture(deps, typeof targetQuestionId === 'string' ? targetQuestionId : undefined)
  })

  ipcMain.handle(IPC.captureOverlayPayload, (): OverlayPayload | null => currentOverlayPayload())

  // ── 识别 ──
  // 手动触发：把这道题的所有截图一起提交，识别后回填到同一条记录
  ipcMain.handle(IPC.visionRecognizeQuestion, async (_e, questionId: string) => {
    const question = deps.store.get(questionId)
    if (!question) throw new Error('题目不存在')
    if (question.imagePaths.length === 0) throw new Error('这道题还没有截图，先截一张再识别')

    deps.store.setRecognizing(questionId, true)
    try {
      const result = await recognizeImages(question.imagePaths)
      await applyRecognition(deps.store, questionId, question.imagePaths[0], result)
      return { questions: result.questions.length, warnings: result.warnings }
    } finally {
      deps.store.setRecognizing(questionId, false)
    }
  })

  // ── 题库 ──
  ipcMain.handle(IPC.questionList, (_e, filter: QuestionFilter) => {
    const safe: QuestionFilter = {
      keyword: filter?.keyword ?? '',
      categoryIds: filter?.categoryIds ?? [],
      knowledgeIds: filter?.knowledgeIds ?? [],
      knowledgeMode: filter?.knowledgeMode ?? 'all',
      kind: filter?.kind ?? 'all',
      status: filter?.status ?? 'all',
      dateFrom: filter?.dateFrom,
      dateTo: filter?.dateTo,
      offset: filter?.offset ?? 0,
      limit: filter?.limit ?? 50
    }
    return deps.store.list(safe)
  })

  ipcMain.handle(IPC.questionGet, (_e, id: string): Question | null => deps.store.get(id))
  ipcMain.handle(IPC.questionSave, (_e, draft: DraftQuestion & { id?: string }) => deps.store.save(draft))
  ipcMain.handle(IPC.questionUpdate, (_e, id: string, patch: Partial<Question>) =>
    deps.store.update(id, patch)
  )
  ipcMain.handle(IPC.questionDelete, (_e, id: string) => deps.store.remove(id))
  ipcMain.handle(IPC.questionFacets, () => deps.store.facets())

  // ── 分类 / 知识点 ──
  ipcMain.handle(IPC.categoryCreate, (_e, name: string) => deps.store.createCategory(name))
  ipcMain.handle(IPC.categoryRename, (_e, id: string, name: string) => deps.store.renameCategory(id, name))
  ipcMain.handle(IPC.categoryDelete, (_e, id: string) => deps.store.deleteCategory(id))
  ipcMain.handle(IPC.kpCreate, (_e, name: string) => deps.store.createKnowledge(name))
  ipcMain.handle(IPC.kpRename, (_e, id: string, name: string) => deps.store.renameKnowledge(id, name))
  ipcMain.handle(IPC.kpDelete, (_e, id: string) => deps.store.deleteKnowledge(id))

  // ── 系统 ──
  ipcMain.handle(IPC.shellShowInFolder, async (_e, path: string) => {
    const abs = resolve(path)
    shell.showItemInFolder(abs)
  })

  ipcMain.handle(IPC.shellOpenExternal, async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.appOpenSettings, () => {
    createSettingsWindow()
  })

  ipcMain.handle(IPC.appOpenMain, () => {
    showMainWindow()
  })

  // 题库窗口要求主窗口打开某道题的抽屉
  ipcMain.handle(IPC.appFocusQuestion, (_e, id: string) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
    win.webContents.send(IPC.questionOpen, id)
  })

  // ── 题库导出 ──
  ipcMain.handle(
    IPC.questionExport,
    async (_e, ids: string[], format: 'md' | 'docx' | 'pdf'): Promise<string | null> => {
      const questions = ids
        .map((id) => deps.store.get(id))
        .filter((question): question is Question => question !== null)
      if (questions.length === 0) throw new Error('没有可导出的题目')

      const facets = deps.store.facets()
      const buffer =
        format === 'docx'
          ? await buildDocx(questions, facets.categories, facets.knowledge)
          : format === 'pdf'
            ? await buildPdf(questions, facets.categories, facets.knowledge)
            : Buffer.from(
                buildMarkdown(questions, facets.categories, facets.knowledge),
                'utf8'
              )

      const stamp = new Date().toISOString().slice(0, 10)

      // 自动化测试用：设置 TIKUBEN_EXPORT_DIR 时直接写文件，跳过保存对话框
      const forcedDir = process.env.TIKUBEN_EXPORT_DIR
      if (forcedDir) {
        await fs.mkdir(forcedDir, { recursive: true })
        const file = join(forcedDir, `题库导出-${Date.now()}.${format}`)
        await fs.writeFile(file, buffer)
        return file
      }

      const parent = getMainWindow()
      const options = {
        title: '导出题库',
        defaultPath: `题库-${stamp}.${format}`,
        filters:
          format === 'docx'
            ? [{ name: 'Word 文档', extensions: ['docx'] }]
            : format === 'pdf'
              ? [{ name: 'PDF', extensions: ['pdf'] }]
              : [{ name: 'Markdown', extensions: ['md'] }]
      }
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null

      await fs.writeFile(result.filePath, buffer)
      return result.filePath
    }
  )
}
