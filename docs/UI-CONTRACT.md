# 渲染进程开发契约

给并行开发渲染进程的 agent 看。主进程、preload、共享类型与样式已经写好，不要改它们。

## 项目事实

- 项目根：`D:\错题本\app`
- 技术栈：Electron 45 + electron-vite 6 + React 19 + TypeScript（`strict: true`）
- 渲染进程根目录：`src/renderer/`，四个 HTML 入口：`index.html`、`viewer.html`、`overlay.html`、`settings.html`
- 源码目录：`src/renderer/src/{main,viewer,overlay,settings,shared}/`
- 路径别名：`@renderer` → `src/renderer/src`，`@shared` → `src/shared`
- 样式：`src/renderer/src/shared/styles.css`（已写好，入口 `main.tsx` 里 import）

## 硬性禁止

- 不要修改：`src/main/**`、`src/preload/**`、`src/shared/**`、`src/renderer/src/shared/**`、四个 html、`electron.vite.config.ts`、`tsconfig*.json`、`package.json`
- 不要引入新的 npm 依赖。需要就停下来，在报告里说明
- 不要跑 `pnpm dev`（会与 Lead 的实例抢窗口与端口）
- 不要用 `any`、`@ts-ignore`、`as unknown as`
- 不要写英文界面文案，全部中文
- 不要用 UI 组件库；图标用内联 SVG
- 不要用 `nodeIntegration`、`window.require`；渲染进程只能用 `window.api`

## 验证方式（每个 agent 自己跑）

```powershell
cd 'D:\错题本\app'
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json
node node_modules/electron-vite/bin/electron-vite.js build
```

两条都必须干净通过。**不要**用 `pnpm exec`（会触发联网安装检查）。

## 已就绪的共享模块（直接 import，不要复制）

```ts
import { api, errorMessage, formatTime, baseName, shortPath, imageUrl } from '@renderer/shared/api'
import { MathMarkdown, MathText } from '@renderer/shared/MathMarkdown'
import { Highlighted, stripMarkdown } from '@renderer/shared/Highlight'
import { toast, Toaster } from '@renderer/shared/toast'
```

- `api`：preload 暴露的 `window.api`，类型见 `src/shared/types.ts` 的 `WindowApi`
- `errorMessage(err)`：剥掉 Electron invoke 的错误前缀，给用户看
- `imageUrl(relPath)`：把 `images/xxx.png` 转成 `tikuben://img/images/xxx.png`，可直接作 `<img src>`
- `MathMarkdown`：Markdown + KaTeX 渲染（`html: false` 防注入）
- `MathText`：行内渲染，不包 `<p>`，用于选项
- `stripMarkdown`：题干转单行纯文本，用于卡片摘要
- `Highlighted`：在纯文本里高亮关键词
- `toast(message, kind?)`：全局提示，`kind` 为 `'info' | 'success' | 'error'`；页面里要挂一次 `<Toaster />`

## 数据模型（`src/shared/types.ts`）

```ts
type QuestionKind = 'wrong' | 'new'
type QuestionStatus = 'draft' | 'confirmed'
type QuestionType = 'choice' | 'fill' | 'solve'

interface Question {
  id: string
  kind: QuestionKind
  questionType: QuestionType
  stem: string              // Markdown，公式 $...$ / $$...$$
  options: { label: string; text: string }[]
  answer: string
  analysis: string
  categoryId: string | null
  knowledgeIds: string[]
  source: { docPath?: string; page?: number; capturedAt: string }
  imagePath: string | null  // 相对 data/，例如 images/x.png
  rawModelOutput: string
  confidence: number        // 0–1
  warnings: string[]
  status: QuestionStatus
  createdAt: string
  updatedAt: string
  recognizing?: boolean     // 仅运行时，主进程正在识别
}

type DraftQuestion = Omit<Question, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'recognizing'>
```

## IPC 契约（`window.api`，全部返回 Promise）

```ts
api.config.get(): AppConfig
api.config.set(patch: Partial<AppConfig> & { apiKey?: string }): AppConfig
api.dialog.pickDocument(): { path: string; kind: 'pdf' | 'docx' } | null
api.doc.openViewer(path: string): void
api.doc.recent(): { path: string; openedAt: string }[]
api.doc.viewerDocument(): { path: string; kind: 'pdf' | 'docx' } | null   // 仅 viewer 窗口
api.doc.readFile(path: string): Uint8Array
api.capture.start(): void                        // 立即返回，结果走事件
api.capture.onResult(cb: (p: { questionId: string; imagePath: string; width: number; height: number }) => void): () => void
api.capture.onError(cb: (message: string) => void): () => void
api.capture.overlayPayload(): { screenshot: string; imageWidth: number; imageHeight: number } | null  // 仅 overlay 窗口
api.capture.selected(rect: { x: number; y: number; width: number; height: number; cssWidth: number; cssHeight: number }): void
api.capture.cancel(): void
api.vision.recognize(imagePath: string): { questions: DraftQuestion[] }
api.question.list(filter: QuestionFilter): { items: Question[]; total: number }
api.question.get(id: string): Question | null
api.question.save(draft: DraftQuestion & { id?: string }): Question   // 保存后 status 变 confirmed
api.question.update(id: string, patch: Partial<Question>): Question
api.question.delete(id: string): void
api.question.facets(): { categories: Category[]; knowledge: KnowledgePoint[] }
api.category.create(name: string): Category
api.category.rename(id: string, name: string): void
api.category.delete(id: string): void
api.kp.create(name: string): KnowledgePoint
api.kp.rename(id: string, name: string): void
api.kp.delete(id: string): void
api.shell.showInFolder(path: string): void
api.shell.openExternal(url: string): void
api.app.openSettings(): void
api.app.openMain(): void
api.db.onChanged(cb: (p: { scope: 'questions' | 'facets' | 'config' }) => void): () => void
```

`QuestionFilter`：

```ts
interface QuestionFilter {
  keyword?: string
  categoryIds?: string[]
  knowledgeIds?: string[]
  knowledgeMode?: 'all' | 'any'
  kind?: QuestionKind | 'all'
  status?: QuestionStatus | 'all'
  dateFrom?: string
  dateTo?: string
  offset: number
  limit: number
}
```

`db.onChanged` 任何写操作成功后触发，收到后重新拉取数据。**记得在 useEffect 里退订**。

## 样式类名清单（`shared/styles.css` 已定义）

布局：`app-shell`、`app-header`、`brand`、`brand-logo`、`app-body`、`sidebar`、`main-pane`
工具栏：`toolbar`、`toolbar-spacer`、`search-box`、`toolbar-select`
表单：`input`、`textarea`、`select`、`field`、`field-label`、`field-hint`、`field-row`、`checkbox`
按钮：`btn`、`btn-primary`、`btn-ghost`、`btn-danger`、`btn-sm`、`btn-icon`
标签：`tag`、`tag-accent`、`tag-ok`、`tag-warn`、`tag-danger`、`tag-dot`、`chip-group`、`chip`、`chip.active`、`chip-x`
侧栏：`sidebar-header`、`sidebar-scroll`、`sidebar-group`、`sidebar-group-title`、`file-item`、`file-icon`、`file-icon.pdf`、`file-icon.docx`、`file-name`、`file-time`
卡片：`card-scroll`、`card-grid`、`question-card`、`card-media`、`card-media-placeholder`、`card-body`、`card-title`、`card-meta`、`card-meta-spacer`、`card-time`
状态：`empty`、`empty-icon`、`empty-title`、`empty-text`、`spinner`、`skeleton`
抽屉：`drawer-overlay`、`drawer`、`drawer-header`、`drawer-title`、`drawer-body`、`drawer-image-pane`、`drawer-form`、`drawer-footer`、`drawer-footer-spacer`、`split-preview`、`preview-box`、`option-row`、`option-label`
阅读器：`viewer-shell`、`viewer-toolbar`、`viewer-title`、`viewer-page-input`、`viewer-canvas-area`、`viewer-docx`、`docx-host`、`viewer-banner`
设置页：`settings-shell`、`settings-title`、`settings-sub`、`settings-section`、`settings-section-title`、`settings-actions`、`mono-path`、`kbd`
遮罩：`overlay-body`、`overlay-stage`、`overlay-shot`、`overlay-dim`、`overlay-selection`、`overlay-hint`、`overlay-size`、`overlay-toolbar`
提示：`toast-stack`、`toast`、`toast.error`、`toast.success`
数学：`math-md`、`math-md-inline`

CSS 变量：`--bg --surface --surface-2 --surface-3 --border --border-2 --text --text-2 --text-3 --accent --accent-hover --accent-soft --danger --danger-soft --ok --ok-soft --warn --warn-soft --radius-sm --radius --radius-lg --shadow-sm --shadow-md --shadow-lg --font-sans --font-mono --header-h`

需要额外样式就写自己的 `.css` 文件并在自己的 `main.tsx` 或组件里 import，**不要改 `shared/styles.css`**。

## 分工

| Agent | 目录 | 内容 |
| --- | --- | --- |
| ui-main | `src/renderer/src/main/` | 主窗口：检索栏、左列文件、卡片流、编辑抽屉、分类/知识点管理 |
| ui-viewer | `src/renderer/src/viewer/` | PDF 阅读器（pdfjs-dist）、DOCX 阅读器（docx-preview） |
| ui-misc | `src/renderer/src/overlay/`、`src/renderer/src/settings/` | 截图遮罩、设置页 |

每个 agent 的入口文件已经存在（`main.tsx` 等），可以整份替换。
