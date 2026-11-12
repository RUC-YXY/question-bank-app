import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { api } from '@renderer/shared/api'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  ScrollPagesIcon,
  SearchIcon,
  SearchNextIcon,
  SinglePageIcon,
  WidthIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons'
import { ToolbarButton, ToolbarTitle, formatError } from './ui'

// worker 必须走 Vite 的 ?url 资源，pdfjs 默认路径在打包后不存在
GlobalWorkerOptions.workerSrc = workerUrl

type ViewerLib = typeof import('pdfjs-dist/web/pdf_viewer.mjs')
type ViewerInstance = InstanceType<ViewerLib['PDFViewer']>

let viewerLibPromise: Promise<ViewerLib> | null = null

/**
 * 官方 viewer 组件在模块顶层就执行 `const {...} = globalThis.pdfjsLib`，
 * 全局没挂载时会解构 undefined 直接抛错，整个渲染进程白屏。
 * 所以先把主入口挂到全局，再动态加载它。
 */
function loadViewerLib(): Promise<ViewerLib> {
  if (!viewerLibPromise) {
    ;(globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = pdfjsLib
    viewerLibPromise = import('pdfjs-dist/web/pdf_viewer.mjs')
  }
  return viewerLibPromise
}

/** 当前页面所在目录。开发时是 dev server 根，打包后是 file:// 下的产物目录。 */
function documentBaseUrl(): string {
  return new URL('.', window.location.href).href
}

// 双栏时每栏只有半个宽度，A4 页面按宽度铺满会算到 40% 以下，下限必须留够
const MIN_SCALE = 0.25
const MAX_SCALE = 3
const SCALE_STEP = 0.1
const MODE_KEY = 'tikuben:pdf-view-mode'

type ViewMode = 'single' | 'scroll'
type LoadPhase = 'loading' | 'ready' | 'error'

interface FindCount {
  current: number
  total: number
}

interface PdfViewerProps {
  path: string
}

function readStoredMode(): ViewMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'single' ? 'single' : 'scroll'
  } catch {
    return 'scroll'
  }
}

function storeMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function clampScale(value: number): number {
  const bounded = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
  return Math.round(bounded * 100) / 100
}

/**
 * PDF 阅读器：渲染与调度交给 pdfjs 官方的 PDFViewer 组件，这里只做 React 封装。
 * 文本层、查找高亮、链接跳转、滚动模式都由官方组件负责，不再自己算预渲染范围。
 */
export function PdfViewer({ path }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<ViewerInstance | null>(null)
  const eventBusRef = useRef<InstanceType<ViewerLib['EventBus']> | null>(null)
  const linkServiceRef = useRef<InstanceType<ViewerLib['PDFLinkService']> | null>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  /** 是否跟随容器宽度自动缩放；用户手动调过缩放就关掉，点「适应宽度」再打开 */
  const autoFitRef = useRef(true)

  const [lib, setLib] = useState<ViewerLib | null>(null)

  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [loadError, setLoadError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [findCount, setFindCount] = useState<FindCount | null>(null)
  const [findPending, setFindPending] = useState(false)
  const [mode, setMode] = useState<ViewMode>(readStoredMode)

  // 先加载官方组件：它内部要读 globalThis.pdfjsLib，必须等挂载完成
  useEffect(() => {
    let alive = true
    void loadViewerLib().then((mod) => {
      if (alive) setLib(mod)
    })
    return () => {
      alive = false
    }
  }, [])

  // 建一次官方 viewer 实例：它自己管页面调度、缩放、文本层与查找
  useEffect(() => {
    if (!lib) return
    const container = containerRef.current
    const viewerEl = viewerElRef.current
    if (!container || !viewerEl) return

    const { EventBus, FindState, PDFFindController, PDFLinkService, PDFViewer, ScrollMode } = lib
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ eventBus, linkService })
    const pdfViewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      findController
    })
    linkService.setViewer(pdfViewer)

    eventBus.on('pagesinit', () => {
      // 首次布局完成后才能算 page-width；换文档时会再来一次
      autoFitRef.current = true
      pdfViewer.currentScaleValue = 'page-width'
      pdfViewer.scrollMode =
        readStoredMode() === 'single' ? ScrollMode.PAGE : ScrollMode.VERTICAL
      setNumPages(pdfViewer.pagesCount)
      setPhase('ready')
    })
    eventBus.on('pagechanging', (event: { pageNumber: number }) => {
      setPageNumber(event.pageNumber)
    })
    eventBus.on('scalechanging', (event: { scale: number }) => {
      setScale(event.scale)
    })
    eventBus.on('updatefindmatchescount', (event: { matchesCount: FindCount }) => {
      setFindCount(event.matchesCount)
    })
    eventBus.on('updatefindcontrolstate', (event: { state: number; matchesCount: FindCount }) => {
      setFindCount(event.matchesCount)
      if (event.state !== FindState.PENDING) setFindPending(false)
    })
    eventBus.on('pagerendered', () => {
      setRenderError('')
    })

    eventBusRef.current = eventBus
    linkServiceRef.current = linkService
    pdfViewerRef.current = pdfViewer

    return () => {
      pdfViewer.setDocument(null)
      linkService.setDocument(null)
      viewerEl.replaceChildren()
      eventBusRef.current = null
      linkServiceRef.current = null
      pdfViewerRef.current = null
    }
  }, [lib])

  // 读文件并交给官方组件；链接服务先拿到文档，内部跳转才能解析
  useEffect(() => {
    let alive = true
    setPhase('loading')
    setLoadError('')
    setRenderError('')
    setFindCount(null)
    setPageNumber(1)
    setPageInput('1')

    const load = async (): Promise<void> => {
      const viewer = pdfViewerRef.current
      const linkService = linkServiceRef.current
      if (!viewer || !linkService) return
      try {
        const data = await api.doc.readFile(path)
        if (!alive) return
        const task = getDocument({
          data,
          // CJK 文本要靠 CMap 才能正确解码，非嵌入字体要靠标准字体数据兜底。
          // 两份资源已复制到 public/ 下，随构建产物一起发布。
          cMapUrl: new URL('cmaps/', documentBaseUrl()).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('standard_fonts/', documentBaseUrl()).href
        })
        loadingTaskRef.current = task
        const document = await task.promise
        if (!alive) {
          void task.destroy().catch(() => undefined)
          return
        }
        linkService.setDocument(document)
        viewer.setDocument(document)
      } catch (err) {
        if (!alive) return
        setLoadError(formatError('打开 PDF 失败', err))
        setPhase('error')
      }
    }

    void load()

    return () => {
      alive = false
      pdfViewerRef.current?.setDocument(null)
      linkServiceRef.current?.setDocument(null)
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      if (task) void task.destroy().catch(() => undefined)
    }
    // lib 就绪后要重跑一次：首次挂载时官方组件还没加载完，实例还不存在
  }, [path, attempt, lib])

  // 单页 / 连续滚动
  useEffect(() => {
    const viewer = pdfViewerRef.current
    if (!viewer || !lib || phase !== 'ready') return
    viewer.scrollMode = mode === 'single' ? lib.ScrollMode.PAGE : lib.ScrollMode.VERTICAL
  }, [mode, phase, lib])

  // 容器宽度变了（开分栏、拖分隔条、拖侧栏）就重算：只要用户没手动缩过
  useEffect(() => {
    if (!lib) return
    const area = containerRef.current
    const viewer = pdfViewerRef.current
    if (!area || !viewer) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (!autoFitRef.current || frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        viewer.currentScaleValue = 'page-width'
      })
    })
    observer.observe(area)
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [lib])

  useEffect(() => {
    setPageInput(String(pageNumber))
  }, [pageNumber])

  const goToPage = useCallback((value: number) => {
    const viewer = pdfViewerRef.current
    if (!viewer) return
    viewer.currentPageNumber = value
  }, [])

  const zoomBy = useCallback((delta: number) => {
    const viewer = pdfViewerRef.current
    if (!viewer) return
    autoFitRef.current = false
    viewer.currentScale = clampScale(viewer.currentScale + delta)
  }, [])

  const fitToWidth = useCallback(() => {
    autoFitRef.current = true
    const viewer = pdfViewerRef.current
    if (viewer) viewer.currentScaleValue = 'page-width'
  }, [])

  // 键盘：PageUp/PageDown 翻页，Ctrl+0 恢复 100%
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault()
        autoFitRef.current = false
        const viewer = pdfViewerRef.current
        if (viewer) viewer.currentScale = 1
        return
      }
      const target = event.target
      const editing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (editing) return
      if (event.key === 'PageDown') {
        event.preventDefault()
        const viewer = pdfViewerRef.current
        if (viewer) viewer.currentPageNumber = viewer.currentPageNumber + 1
      } else if (event.key === 'PageUp') {
        event.preventDefault()
        const viewer = pdfViewerRef.current
        if (viewer) viewer.currentPageNumber = viewer.currentPageNumber - 1
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const totalPages = Math.max(1, numPages)
  const ready = phase === 'ready'

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isNaN(parsed)) {
      setPageInput(String(pageNumber))
      return
    }
    goToPage(parsed)
  }

  /** 把查找请求交给官方 findController，高亮与翻页由它负责 */
  const runSearch = (type: 'find' | 'findagain', findPrevious = false) => {
    const viewer = pdfViewerRef.current
    const eventBus = eventBusRef.current
    if (!viewer || !eventBus) return
    const keyword = query.trim()
    if (!keyword) {
      setFindCount(null)
      return
    }
    if (type === 'find') setFindPending(true)
    eventBus.dispatch('find', {
      source: viewer,
      type,
      query: keyword,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      phraseSearch: true
    })
  }

  const jumpToNextHit = () => {
    if (!findCount || findCount.total === 0) return
    runSearch('findagain')
  }

  const switchMode = (next: ViewMode): void => {
    if (next === mode) return
    setMode(next)
    storeMode(next)
  }

  return (
    <>
      <div className="viewer-toolbar">
        <ToolbarTitle path={path} />
        <span className="toolbar-spacer" />
        <ToolbarButton
          label="上一页"
          iconOnly
          disabled={!ready || pageNumber <= 1}
          onClick={() => goToPage(pageNumber - 1)}
        >
          <ChevronLeftIcon />
        </ToolbarButton>
        <ToolbarButton
          label="下一页"
          iconOnly
          disabled={!ready || pageNumber >= totalPages}
          onClick={() => goToPage(pageNumber + 1)}
        >
          <ChevronRightIcon />
        </ToolbarButton>
        <input
          className="input viewer-page-input"
          aria-label="页码"
          inputMode="numeric"
          value={pageInput}
          disabled={!ready}
          onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitPageInput()
            } else if (event.key === 'Escape') {
              setPageInput(String(pageNumber))
            }
          }}
          onBlur={() => setPageInput(String(pageNumber))}
        />
        <span className="viewer-page-total">/ {numPages > 0 ? numPages : '—'}</span>

        <div className="viewer-mode-switch" role="group" aria-label="翻页模式">
          <ToolbarButton
            label="单页翻页"
            iconOnly
            className={mode === 'single' ? 'active' : undefined}
            disabled={!ready}
            onClick={() => switchMode('single')}
          >
            <SinglePageIcon />
          </ToolbarButton>
          <ToolbarButton
            label="连续滚动"
            iconOnly
            className={mode === 'scroll' ? 'active' : undefined}
            disabled={!ready}
            onClick={() => switchMode('scroll')}
          >
            <ScrollPagesIcon />
          </ToolbarButton>
        </div>

        <ToolbarButton
          label="缩小"
          iconOnly
          disabled={!ready || scale <= MIN_SCALE}
          onClick={() => zoomBy(-SCALE_STEP)}
        >
          <ZoomOutIcon />
        </ToolbarButton>
        <button
          type="button"
          className="btn btn-ghost btn-sm viewer-zoom-label"
          title="点击恢复到 100%"
          onClick={() => {
            autoFitRef.current = false
            const viewer = pdfViewerRef.current
            if (viewer) viewer.currentScale = 1
          }}
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolbarButton
          label="放大"
          iconOnly
          disabled={!ready || scale >= MAX_SCALE}
          onClick={() => zoomBy(SCALE_STEP)}
        >
          <ZoomInIcon />
        </ToolbarButton>
        <ToolbarButton label="适应宽度" iconOnly disabled={!ready} onClick={fitToWidth}>
          <WidthIcon />
        </ToolbarButton>

        <div className="search-box">
          <SearchIcon size={13} />
          <input
            className="input"
            placeholder="搜索文档内容"
            aria-label="搜索文档内容"
            value={query}
            disabled={!ready}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                runSearch('find')
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!ready || findPending}
          onClick={() => runSearch('find')}
        >
          {findPending ? <span className="spinner" /> : '搜索'}
        </button>
      </div>

      {renderError && (
        <div className="viewer-banner">
          <span>{renderError}</span>
        </div>
      )}

      {findCount && (
        <div className="viewer-search-status">
          {findCount.total > 0 ? (
            <>
              <span>
                「{query.trim()}」命中 {findCount.total} 处，当前第 {findCount.current} 处
              </span>
              <ToolbarButton label="跳到下一个命中" onClick={jumpToNextHit}>
                <SearchNextIcon />
                下一个
              </ToolbarButton>
            </>
          ) : (
            <span className="viewer-search-empty">没有找到「{query.trim()}」</span>
          )}
        </div>
      )}

      <div className="pdf-viewer-host">
        <div className="viewer-canvas-area pdf-viewer-area" ref={containerRef}>
          <div className="pdfViewer" ref={viewerElRef} />
          {phase === 'loading' && (
            <div className="viewer-state viewer-state-overlay">
              <span className="spinner" />
              <span>正在打开 PDF…</span>
            </div>
          )}
          {phase === 'error' && (
            <div className="viewer-state viewer-state-overlay viewer-state-error">
              <span>{loadError}</span>
              <ToolbarButton label="重试" onClick={() => setAttempt((current) => current + 1)}>
                <RefreshIcon />
                重试
              </ToolbarButton>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
