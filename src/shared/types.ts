/**
 * 主进程与渲染进程共用的类型与 IPC 通道名。
 * 这个文件是契约：主进程、preload、渲染进程都以它为准，不要各写一份。
 */

// ──────────────────────────── 数据模型 ────────────────────────────

export type QuestionKind = 'wrong' | 'new'
export type QuestionStatus = 'draft' | 'confirmed'
export type QuestionType = 'choice' | 'fill' | 'solve'

export interface QuestionOption {
  label: string
  text: string
}

export interface QuestionSource {
  docPath?: string
  page?: number
  /** ISO 8601 带时区 */
  capturedAt: string
}

export interface Question {
  id: string
  kind: QuestionKind
  questionType: QuestionType
  /** Markdown，公式用 $...$ 与 $$...$$ */
  stem: string
  options: QuestionOption[]
  /** 未识别到就是空串，不编造 */
  answer: string
  analysis: string
  categoryId: string | null
  knowledgeIds: string[]
  source: QuestionSource
  /** 相对 data/ 目录，例如 ["images/8f3a.png"]；同一道题可以挂多张（题干、解答各一张） */
  imagePaths: string[]
  rawModelOutput: string
  /** 0–1 */
  confidence: number
  warnings: string[]
  status: QuestionStatus
  createdAt: string
  updatedAt: string
  /** 仅运行时字段：主进程正在识别该题，不落盘 */
  recognizing?: boolean
}

/** Question 去掉 id / status / 时间戳与运行时字段 */
export type DraftQuestion = Omit<
  Question,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'recognizing'
>

export interface Category {
  id: string
  name: string
  order: number
}

export interface KnowledgePoint {
  id: string
  name: string
}

export interface RecentDoc {
  path: string
  openedAt: string
}

export interface AppConfig {
  apiBaseUrl: string
  apiModel: string
  /** 只回传是否存在，绝不回传密钥 */
  hasApiKey: boolean
  shortcut: string
  useMock: boolean
  /** 只读展示 */
  dataDir: string
  recentDocs: RecentDoc[]
}

export interface QuestionFilter {
  /** 空则不过滤 */
  keyword?: string
  /** 空数组表示不限 */
  categoryIds?: string[]
  /** 多选，默认交集 */
  knowledgeIds?: string[]
  knowledgeMode?: 'all' | 'any'
  kind?: QuestionKind | 'all'
  status?: QuestionStatus | 'all'
  dateFrom?: string
  dateTo?: string
  offset: number
  limit: number
}

export interface Facets {
  categories: Category[]
  knowledge: KnowledgePoint[]
}

export interface PickedDocument {
  path: string
  kind: 'pdf' | 'docx'
}

// ──────────────────────────── 识别 ────────────────────────────

export interface RawRecognizedQuestion {
  stem: string
  options: QuestionOption[]
  answer: string
  analysis: string
  questionType: QuestionType
  confidence: number
  warnings: string[]
}

export interface RecognitionResult {
  questions: RawRecognizedQuestion[]
  warnings: string[]
  raw: string
  provider: 'api' | 'mock'
}

// ──────────────────────────── 截图 ────────────────────────────

/** 遮罩页回传的选区（CSS 像素） */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
  /** 选区所在 CSS 视口宽高，用于换算物理像素 */
  cssWidth: number
  cssHeight: number
}

export interface CapturePayload {
  questionId: string
  imagePath: string
  width: number
  height: number
  /** true 表示追加到已有题目，false 表示新建了一道草稿 */
  appended: boolean
}

/** 遮罩窗口启动载荷 */
export interface OverlayPayload {
  /** 当前屏截图的 data URL */
  screenshot: string
  /** 图片原始像素宽高 */
  imageWidth: number
  imageHeight: number
}

export interface ViewerDocument {
  path: string
  kind: 'pdf' | 'docx' | 'image'
}

// ──────────────────────────── IPC 通道 ────────────────────────────

export const IPC = {
  // 配置
  configGet: 'config:get',
  configSet: 'config:set',
  // 文档
  dialogPickDocument: 'dialog:pickDocument',
  docOpenViewer: 'doc:openViewer',
  docTouch: 'doc:touch',
  docRecent: 'doc:recent',
  docViewerDocument: 'doc:viewerDocument',
  docReadFile: 'doc:readFile',
  // 截图
  captureStart: 'capture:start',
  captureResult: 'capture:onResult',
  captureError: 'capture:error',
  captureOverlayPayload: 'capture:overlayPayload',
  captureSelected: 'capture:selected',
  captureCancel: 'capture:cancel',
  // 识别
  visionRecognizeQuestion: 'vision:recognizeQuestion',
  // 题库
  questionList: 'question:list',
  questionGet: 'question:get',
  questionSave: 'question:save',
  questionUpdate: 'question:update',
  questionDelete: 'question:delete',
  questionFacets: 'question:facets',
  questionExport: 'question:export',
  questionOpen: 'question:open',
  // 分类与知识点
  categoryCreate: 'category:create',
  categoryRename: 'category:rename',
  categoryDelete: 'category:delete',
  kpCreate: 'kp:create',
  kpRename: 'kp:rename',
  kpDelete: 'kp:delete',
  // 系统
  shellShowInFolder: 'shell:showInFolder',
  shellOpenExternal: 'shell:openExternal',
  appOpenSettings: 'app:openSettings',
  appOpenMain: 'app:openMain',
  appFocusQuestion: 'app:focusQuestion',
  // 主进程推送
  dbChanged: 'db:changed'
} as const

export interface DbChangedPayload {
  scope: 'questions' | 'facets' | 'config'
}

// ──────────────────────────── window.api ────────────────────────────

export interface WindowApi {
  config: {
    get(): Promise<AppConfig>
    set(patch: Partial<AppConfig> & { apiKey?: string }): Promise<AppConfig>
  }
  dialog: {
    pickDocument(): Promise<PickedDocument | null>
  }
  doc: {
    openViewer(path: string): Promise<void>
    /** 只更新最近文档列表，不开窗口 */
    touch(path: string): Promise<void>
    recent(): Promise<RecentDoc[]>
    viewerDocument(): Promise<ViewerDocument | null>
    readFile(path: string): Promise<Uint8Array>
  }
  capture: {
    /** 不传 targetQuestionId 就新建一条草稿；传了就追加到那道题 */
    start(targetQuestionId?: string): Promise<void>
    onResult(cb: (payload: CapturePayload) => void): () => void
    onError(cb: (message: string) => void): () => void
    overlayPayload(): Promise<OverlayPayload | null>
    selected(rect: SelectionRect): void
    cancel(): void
  }
  vision: {
    /** 把这道题的所有截图一起提交识别，结果直接写回题目 */
    recognizeQuestion(questionId: string): Promise<{ questions: number; warnings: string[] }>
  }
  files: {
    /** 拖进窗口的文件的本地路径；拿不到时返回空串 */
    getPath(file: File): string
  }
  question: {
    list(filter: QuestionFilter): Promise<{ items: Question[]; total: number }>
    get(id: string): Promise<Question | null>
    save(draft: DraftQuestion & { id?: string }): Promise<Question>
    update(id: string, patch: Partial<Question>): Promise<Question>
    delete(id: string): Promise<void>
    facets(): Promise<Facets>
    /** 主进程要求主窗口打开某道题的抽屉 */
    onOpen(cb: (id: string) => void): () => void
  }
  category: {
    create(name: string): Promise<Category>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  kp: {
    create(name: string): Promise<KnowledgePoint>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  shell: {
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  app: {
    openSettings(): Promise<void>
    openMain(): Promise<void>
    /** 把主窗口带到前台并打开某道题的抽屉 */
    focusQuestion(id: string): Promise<void>
  }
  library: {
    /** 导出选中的题目，返回保存路径；用户取消时返回 null */
    exportQuestions(ids: string[], format: 'md' | 'docx' | 'pdf'): Promise<string | null>
  }
  db: {
    onChanged(cb: (payload: DbChangedPayload) => void): () => void
  }
}
