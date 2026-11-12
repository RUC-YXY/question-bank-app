import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Category, KnowledgePoint, Question, RecentDoc, ViewerDocument } from '@shared/types'
import { api, errorMessage } from '@renderer/shared/api'
import { toast, Toaster } from '@renderer/shared/toast'
import { buildQuestionFilter, EMPTY_FILTER, PAGE_LIMIT, type FilterState } from './filters'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { CardGrid } from './components/CardGrid'
import { Drawer } from './components/Drawer'
import { ManageModal } from './components/ManageModal'
import { ReaderPane } from './components/ReaderPane'
import { LibraryView } from './components/LibraryView'
import { BookIcon, PanelIcon } from './components/Icons'

/** 阅读器宽度占「左列之外、分隔条之外」可用宽度的比例 */
const READER_RATIO_KEY = 'tikuben:reader-width'
const READER_RATIO_DEFAULT = 0.34
const READER_RATIO_MIN = 0.2
const READER_RATIO_MAX = 0.75
/** 左列文件栏宽度，可拖动，范围 200–460 */
const SIDEBAR_WIDTH_KEY = 'tikuben:sidebar-width'
const SIDEBAR_DEFAULT = 268
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 460
/** 分隔条 6px，两条 */
const DIVIDER_WIDTH = 6
/** 再窄就拖不动了：给右侧题库留出最低可读宽度（一张卡片最窄能用到这个宽度） */
const QUESTION_COL_MIN = 300
/** 双栏时左栏占阅读器区宽度的比例 */
const PANE_RATIO_KEY = 'tikuben:pane-ratio'
const PANE_RATIO_DEFAULT = 0.5
const PANE_RATIO_MIN = 0.2
const PANE_RATIO_MAX = 0.8
/** 左列文件栏是否收起 */
const SIDEBAR_HIDDEN_KEY = 'tikuben:sidebar-hidden'

function readStoredPaneRatio(): number {
  try {
    const raw = window.localStorage.getItem(PANE_RATIO_KEY)
    if (raw === null) return PANE_RATIO_DEFAULT
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) return PANE_RATIO_DEFAULT
    return Math.min(PANE_RATIO_MAX, Math.max(PANE_RATIO_MIN, value))
  } catch {
    return PANE_RATIO_DEFAULT
  }
}

function readStoredSidebarHidden(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function readStoredSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw === null) return SIDEBAR_DEFAULT
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) return SIDEBAR_DEFAULT
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value))
  } catch {
    return SIDEBAR_DEFAULT
  }
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return READER_RATIO_DEFAULT
  return Math.min(READER_RATIO_MAX, Math.max(READER_RATIO_MIN, value))
}

function readStoredRatio(): number {
  try {
    const raw = window.localStorage.getItem(READER_RATIO_KEY)
    if (raw === null) return READER_RATIO_DEFAULT
    return clampRatio(Number.parseFloat(raw))
  } catch {
    return READER_RATIO_DEFAULT
  }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i

type PaneId = 'primary' | 'secondary'

function kindOfPath(path: string): ViewerDocument['kind'] {
  if (/\.docx$/i.test(path)) return 'docx'
  if (IMAGE_EXT.test(path)) return 'image'
  return 'pdf'
}

/** 只记录最近文档、不开窗口。 */
async function touchRecentDocument(path: string): Promise<void> {
  try {
    await api.doc.touch(path)
  } catch {
    // 最近文档没记上也照常读文档
  }
}

export function App() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER)
  const [query, setQuery] = useState('')
  const [keyword, setKeyword] = useState('')

  const [items, setItems] = useState<Question[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [categories, setCategories] = useState<Category[]>([])
  const [knowledge, setKnowledge] = useState<KnowledgePoint[]>([])
  const [recent, setRecent] = useState<RecentDoc[]>([])
  const [primaryDoc, setPrimaryDoc] = useState<ViewerDocument | null>(null)
  const [secondaryDoc, setSecondaryDoc] = useState<ViewerDocument | null>(null)
  const [split, setSplit] = useState(false)
  const [focusedPane, setFocusedPane] = useState<PaneId>('primary')
  const [view, setView] = useState<'editor' | 'library'>('editor')

  const [readerRatio, setReaderRatio] = useState<number>(readStoredRatio)
  const [sidebarWidth, setSidebarWidth] = useState<number>(readStoredSidebarWidth)
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(readStoredSidebarHidden)
  const [paneRatio, setPaneRatio] = useState<number>(readStoredPaneRatio)
  const [dragging, setDragging] = useState(false)
  const [sidebarDragging, setSidebarDragging] = useState(false)
  const [paneDragging, setPaneDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSnapshot, setSelectedSnapshot] = useState<Question | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)

  const seqRef = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startRatio: number; available: number } | null>(null)
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  /** 双栏分界拖动：记下阅读器区的左边界与宽度，按指针位置直接算比例 */
  const paneDragRef = useRef<{ left: number; width: number } | null>(null)
  const readerAreaRef = useRef<HTMLDivElement>(null)

  // 阅读器宽度写进 CSS 变量，列宽由 main.css 按比例算，窗口缩放时自动跟随
  useEffect(() => {
    const node = bodyRef.current
    if (node) node.style.setProperty('--reader-ratio', String(readerRatio))
  }, [readerRatio])

  // 左列宽度也走 CSS 变量，阅读器的比例基于「扣掉左列与两条分隔条之后的宽度」
  useEffect(() => {
    const node = bodyRef.current
    if (node) node.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
  }, [sidebarWidth])

  // 双栏分界比例同样交给 CSS，窗口缩放时两栏按比例跟随
  useEffect(() => {
    const node = bodyRef.current
    if (node) node.style.setProperty('--pane-ratio', String(paneRatio))
  }, [paneRatio])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PANE_RATIO_KEY, String(paneRatio))
      } catch {
        // 存储不可用时只是不持久化
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [paneRatio])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? '1' : '0')
    } catch {
      // 存储不可用时只是不持久化
    }
  }, [sidebarHidden])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
      } catch {
        // 存储不可用时只是不持久化
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sidebarWidth])

  // 记住用户拖出来的宽度，刷新后保留。拖动中比例每帧都在变，防抖后再落盘
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(READER_RATIO_KEY, String(readerRatio))
      } catch {
        // 存储不可用时只是不持久化，不影响当前窗口
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [readerRatio])

  // 拖动期间：跟随指针改比例，并全局禁掉文本选中、切到 col-resize
  useEffect(() => {
    if (!dragging) return
    const body = document.body
    const prevCursor = body.style.cursor
    const prevUserSelect = body.style.userSelect
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'

    const onMove = (event: PointerEvent): void => {
      const sidebarDrag = sidebarDragRef.current
      if (sidebarDrag) {
        const delta = event.clientX - sidebarDrag.startX
        setSidebarWidth(
          Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, sidebarDrag.startWidth + delta))
        )
        return
      }
      const paneDrag = paneDragRef.current
      if (paneDrag) {
        const next = (event.clientX - paneDrag.left) / paneDrag.width
        setPaneRatio(Math.min(PANE_RATIO_MAX, Math.max(PANE_RATIO_MIN, next)))
        return
      }
      const drag = dragRef.current
      if (!drag) return
      const delta = event.clientX - drag.startX
      // 右侧题库留出最低宽度后才是真正能拖到的最右位置，仍受 20%–75% 约束
      const rightmost = (drag.available - QUESTION_COL_MIN) / drag.available
      const upper = Math.max(READER_RATIO_MIN, Math.min(READER_RATIO_MAX, rightmost))
      const next = drag.startRatio + delta / drag.available
      setReaderRatio(Math.min(upper, Math.max(READER_RATIO_MIN, next)))
    }
    const onEnd = (): void => {
      dragRef.current = null
      sidebarDragRef.current = null
      paneDragRef.current = null
      setDragging(false)
      setSidebarDragging(false)
      setPaneDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      body.style.cursor = prevCursor
      body.style.userSelect = prevUserSelect
    }
  }, [dragging])

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      const body = bodyRef.current
      // 收起左列后它和它的分隔条都不占位置，可用宽度要跟着多算回来
      const sidebarSpace = sidebarHidden ? 0 : sidebarWidth + DIVIDER_WIDTH
      const available = body ? body.clientWidth - sidebarSpace - DIVIDER_WIDTH : 0
      if (available <= 0) return
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startRatio: readerRatio, available }
      setDragging(true)
    },
    [readerRatio, sidebarHidden, sidebarWidth]
  )

  const startPaneResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const area = readerAreaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    if (rect.width <= 0) return
    event.preventDefault()
    paneDragRef.current = { left: rect.left, width: rect.width }
    setPaneDragging(true)
    setDragging(true)
  }, [])

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      sidebarDragRef.current = { startX: event.clientX, startWidth: sidebarWidth }
      setSidebarDragging(true)
      setDragging(true)
    },
    [sidebarWidth]
  )

  // 搜索框输入 200ms 后才真正查询
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(async (): Promise<void> => {
    const seq = seqRef.current + 1
    seqRef.current = seq
    setLoading(true)
    try {
      const result = await api.question.list(buildQuestionFilter(filters, keyword))
      if (seq !== seqRef.current) return
      setItems(result.items)
      setTotal(result.total)
    } catch (err) {
      if (seq === seqRef.current) toast(errorMessage(err), 'error')
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [filters, keyword])

  const loadFacets = useCallback(async (): Promise<void> => {
    try {
      const result = await api.question.facets()
      setCategories(result.categories)
      setKnowledge(result.knowledge)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [])

  const loadRecent = useCallback(async (): Promise<void> => {
    try {
      setRecent(await api.doc.recent())
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadFacets()
    void loadRecent()
  }, [loadFacets, loadRecent])

  // 任何写操作成功后主进程推 db:changed，按 scope 重新拉取
  useEffect(() => {
    const off = api.db.onChanged((payload) => {
      if (payload.scope === 'questions') {
        void load()
        return
      }
      if (payload.scope === 'facets') {
        void loadFacets()
        void load()
        return
      }
      void loadRecent()
    })
    return off
  }, [load, loadFacets, loadRecent])

  // 截图结果回来：刷新列表并准备把新卡片滚进视野
  useEffect(() => {
    const offResult = api.capture.onResult((payload) => {
      toast('截图已保存，打开卡片点「识别」')
      setScrollTarget(payload.questionId)
      void load()
    })
    const offError = api.capture.onError((message) => {
      toast(message, 'error')
    })
    return () => {
      offResult()
      offError()
    }
  }, [load])

  useEffect(() => {
    if (!scrollTarget) return
    const node = document.querySelector<HTMLElement>(`[data-question-id="${scrollTarget}"]`)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollTarget(null)
      return
    }
    const timer = window.setTimeout(() => setScrollTarget(null), 5000)
    return () => window.clearTimeout(timer)
  }, [items, scrollTarget])

  const selected = useMemo<Question | null>(() => {
    if (!selectedId) return null
    return items.find((question) => question.id === selectedId) ?? selectedSnapshot
  }, [items, selectedId, selectedSnapshot])

  const draftSiblings = useMemo(() => {
    if (!selected) return 0
    return items.filter((question) => question.status === 'draft' && question.id !== selected.id).length
  }, [items, selected])

  const patchFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const startCapture = useCallback(async (): Promise<void> => {
    try {
      await api.capture.start()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [])

  /** 在主窗口内加载文档：写进当前焦点栏，不开独立窗口 */
  const loadDoc = useCallback(
    async (doc: ViewerDocument, pane: PaneId = focusedPane): Promise<void> => {
      if (pane === 'primary') setPrimaryDoc(doc)
      else setSecondaryDoc(doc)
      setFocusedPane(pane)
      await touchRecentDocument(doc.path)
      await loadRecent()
    },
    [focusedPane, loadRecent]
  )

  const openDocument = useCallback(async (): Promise<void> => {
    try {
      const picked = await api.dialog.pickDocument()
      if (!picked) return
      await loadDoc(picked)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [loadDoc])

  const openDoc = useCallback(
    async (path: string): Promise<void> => {
      try {
        await loadDoc({ path, kind: kindOfPath(path) })
      } catch (err) {
        toast(errorMessage(err), 'error')
      }
    },
    [loadDoc]
  )

  // 拖文件进窗口：PDF/DOCX 和图片都进阅读器查看，录入仍然靠截图
  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    }

    const onDragLeave = (event: DragEvent): void => {
      // relatedTarget 为 null 表示真的离开窗口，而不是在子元素之间移动
      if (event.relatedTarget === null) setDragOver(false)
    }

    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragOver(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      const path = api.files.getPath(file)
      if (!path) {
        toast('拿不到文件路径，换一种方式打开试试', 'error')
        return
      }
      if (/\.(pdf|docx)$/i.test(path) || IMAGE_EXT.test(path)) {
        void openDoc(path)
        return
      }
      toast('只支持 PDF、DOCX 和常见图片格式', 'error')
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openDoc])

  /** 关闭某一栏；关主栏时把副栏的文档提上来，避免文档凭空消失 */
  const closePane = useCallback(
    (pane: PaneId): void => {
      if (pane === 'primary') {
        setPrimaryDoc(secondaryDoc)
        setSecondaryDoc(null)
      } else {
        setSecondaryDoc(null)
      }
      setSplit(false)
      setFocusedPane('primary')
    },
    [secondaryDoc]
  )

  const toggleSplit = useCallback((): void => {
    setSplit((prev) => {
      if (prev) setSecondaryDoc(null)
      return !prev
    })
    setFocusedPane('primary')
  }, [])

  const openSettings = useCallback(async (): Promise<void> => {
    try {
      await api.app.openSettings()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [])

  const deleteQuestion = useCallback(
    async (question: Question): Promise<void> => {
      if (!window.confirm('确定删除这道题吗？删除后无法恢复。')) return
      try {
        await api.question.delete(question.id)
        toast('已删除', 'success')
        await load()
      } catch (err) {
        toast(errorMessage(err), 'error')
      }
    },
    [load]
  )

  const refreshAll = useCallback((): void => {
    void load()
    void loadFacets()
    void loadRecent()
  }, [load, loadFacets, loadRecent])

  // 题库窗口点「修改」时，主进程会让主窗口打开这道题的抽屉
  useEffect(() => {
    const off = api.question.onOpen((id) => {
      void (async () => {
        try {
          const question = await api.question.get(id)
          if (!question) return
          setSelectedSnapshot(question)
          setSelectedId(id)
        } catch {
          // 题目可能刚被删掉，忽略
        }
      })()
    })
    return off
  }, [])

  const openCard = useCallback((question: Question): void => {
    setSelectedSnapshot(question)
    setSelectedId(question.id)
  }, [])

  const closeDrawer = useCallback((): void => {
    setSelectedId(null)
    setSelectedSnapshot(null)
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">
            <BookIcon size={15} />
          </span>
          题库本
        </div>
        <div className="view-tabs" role="tablist" aria-label="视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'editor'}
            className={view === 'editor' ? 'active' : ''}
            onClick={() => setView('editor')}
          >
            录入
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'library'}
            className={view === 'library' ? 'active' : ''}
            onClick={() => setView('library')}
          >
            题库
          </button>
        </div>
        <div className="toolbar-spacer" />
        {view === 'editor' && (
          <button
            type="button"
            className={`btn btn-ghost btn-icon${sidebarHidden ? '' : ' active'}`}
            title={sidebarHidden ? '显示左侧文件栏' : '隐藏左侧文件栏'}
            aria-label={sidebarHidden ? '显示左侧文件栏' : '隐藏左侧文件栏'}
            aria-pressed={!sidebarHidden}
            onClick={() => setSidebarHidden((prev) => !prev)}
          >
            <PanelIcon />
          </button>
        )}
        <span className="header-hint">
          按 <kbd className="kbd">Alt+Shift+S</kbd> 随时录入新题
        </span>
      </header>

      {view === 'editor' && (
        <div
          className={`app-body${dragging ? ' resizing' : ''}${sidebarHidden ? ' sidebar-hidden' : ''}`}
          ref={bodyRef}
        >
        {!sidebarHidden && (
          <>
            <Sidebar
              docs={recent}
              activePath={
                focusedPane === 'primary' ? (primaryDoc?.path ?? null) : (secondaryDoc?.path ?? null)
              }
              onOpen={(path) => void openDoc(path)}
              onRefresh={refreshAll}
            />

            <div
              className={`split-divider${sidebarDragging ? ' active' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整文件列表宽度"
              aria-valuenow={Math.round(sidebarWidth)}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              title="拖动调整文件列表宽度，双击恢复默认"
              onPointerDown={startSidebarResize}
              onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            />
          </>
        )}

        <div className={`reader-area${split ? ' split' : ''}`} ref={readerAreaRef}>
          <ReaderPane
            doc={primaryDoc}
            split={split}
            focused={focusedPane === 'primary'}
            onFocus={() => setFocusedPane('primary')}
            onClose={() => closePane('primary')}
            onToggleSplit={toggleSplit}
          />
          {split && (
            <>
              <div
                className={`split-divider pane-divider${paneDragging ? ' active' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整两栏宽度"
                aria-valuenow={Math.round(paneRatio * 100)}
                aria-valuemin={Math.round(PANE_RATIO_MIN * 100)}
                aria-valuemax={Math.round(PANE_RATIO_MAX * 100)}
                title="拖动调整两栏宽度，双击恢复均分"
                onPointerDown={startPaneResize}
                onDoubleClick={() => setPaneRatio(PANE_RATIO_DEFAULT)}
              />
              <ReaderPane
                doc={secondaryDoc}
                split={split}
                focused={focusedPane === 'secondary'}
                onFocus={() => setFocusedPane('secondary')}
                onClose={() => closePane('secondary')}
                onToggleSplit={toggleSplit}
              />
            </>
          )}
        </div>

        <div
          className={`split-divider${dragging ? ' active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整阅读器宽度"
          aria-valuenow={Math.round(readerRatio * 100)}
          aria-valuemin={Math.round(READER_RATIO_MIN * 100)}
          aria-valuemax={Math.round(READER_RATIO_MAX * 100)}
          title="拖动调整阅读器宽度，双击恢复默认"
          onPointerDown={startResize}
          onDoubleClick={() => setReaderRatio(READER_RATIO_DEFAULT)}
        />

        <main className="main-pane">
          <Toolbar
            query={query}
            onQueryChange={setQuery}
            filters={filters}
            onPatch={patchFilters}
            categories={categories}
            knowledge={knowledge}
            onCapture={() => void startCapture()}
            onOpenDocument={() => void openDocument()}
            onOpenManage={() => setManageOpen(true)}
            onOpenSettings={() => void openSettings()}
          />

          <div className="list-header">
            <span className="list-count">
              {loading && total === 0 ? '加载中…' : `共 ${total} 条`}
            </span>
            {total > items.length && (
              <span>
                当前只显示前 {items.length} 条（一次最多 {PAGE_LIMIT} 条）
              </span>
            )}
          </div>

          <CardGrid
            items={items}
            loading={loading}
            keyword={keyword}
            categories={categories}
            knowledge={knowledge}
            onOpen={openCard}
            onDelete={(question) => void deleteQuestion(question)}
          />
        </main>
        </div>
      )}

      {view === 'library' && <LibraryView />}

      {selected && (
        <Drawer
          key={selected.id}
          question={selected}
          categories={categories}
          knowledge={knowledge}
          draftSiblings={draftSiblings}
          onRefresh={load}
          onClose={closeDrawer}
        />
      )}

      {manageOpen && (
        <ManageModal
          categories={categories}
          knowledge={knowledge}
          onClose={() => setManageOpen(false)}
        />
      )}

      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-card">
            <BookIcon size={26} />
            <div className="drop-title">松开以打开</div>
            <div className="drop-hint">PDF / DOCX 进阅读器，图片也能拖进来查看</div>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  )
}
