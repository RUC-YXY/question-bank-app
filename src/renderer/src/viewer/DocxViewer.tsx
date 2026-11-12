import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { api } from '@renderer/shared/api'
import { RefreshIcon, WarningIcon, ZoomInIcon, ZoomOutIcon } from './icons'
import { ToolbarButton, ToolbarTitle, formatError } from './ui'

const MIN_SCALE = 0.5
const MAX_SCALE = 2
const SCALE_STEP = 0.1
/** 空段落占比超过这个比例就提示公式可能显示不全 */
const EMPTY_PARAGRAPH_LIMIT = 0.05

const FRAME_SRCDOC =
  '<!doctype html><html><head></head><body style="margin:0;padding:0;overflow-x:auto;overflow-y:hidden;"></body></html>'

const FRAME_STYLE = [
  'html,body{margin:0;padding:0;background:#fff;}',
  'body{color:#14181f;font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",system-ui,sans-serif;}'
].join('')

function clampScale(value: number): number {
  const bounded = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
  return Math.round(bounded * 100) / 100
}

function measureHeight(doc: Document): number {
  const body = doc.body
  const root = doc.documentElement
  const height = Math.max(body.scrollHeight, body.offsetHeight, root ? root.scrollHeight : 0)
  // 多留 1px，避免四舍五入后 iframe 内部出现细小滚动条
  return height > 0 ? Math.ceil(height) + 1 : 600
}

/** 空段落占比：docx 转换时公式常变成空段落，占比高就说明内容可能缺失 */
function emptyParagraphRatio(doc: Document): number {
  const paragraphs = Array.from(doc.querySelectorAll('p'))
  if (paragraphs.length === 0) return 0
  let empty = 0
  for (const paragraph of paragraphs) {
    if ((paragraph.textContent ?? '').trim() === '') empty += 1
  }
  return empty / paragraphs.length
}

function applyFrameStyle(doc: Document) {
  const style = doc.createElement('style')
  style.textContent = FRAME_STYLE
  doc.head.appendChild(style)
}

type Phase = 'loading' | 'ready' | 'error'

interface DocxViewerProps {
  path: string
}

export function DocxViewer({ path }: DocxViewerProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState(0)
  const [showBanner, setShowBanner] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement>(null)

  // 等 iframe 的 srcdoc 文档就绪；load 事件可能早于 effect 挂载，用 readyState 兜底
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const handleLoad = () => setFrameReady(true)
    iframe.addEventListener('load', handleLoad)
    const doc = iframe.contentDocument
    if (doc && doc.readyState === 'complete') setFrameReady(true)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [])

  // 把 DOCX 渲染进 iframe，样式与内容都关在里面，不污染宿主页面
  useEffect(() => {
    if (!frameReady) return
    const iframe = iframeRef.current
    const doc = iframe ? iframe.contentDocument : null
    if (!doc) {
      setMessage('无法初始化文档容器，请重试')
      setPhase('error')
      return
    }

    let alive = true
    setPhase('loading')
    setMessage('')
    setShowBanner(false)

    const render = async () => {
      try {
        const data = await api.doc.readFile(path)
        if (!alive) return
        await renderAsync(data, doc.body, doc.head, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true
        })
        if (!alive) return
        applyFrameStyle(doc)
        setContentHeight(measureHeight(doc))
        setShowBanner(emptyParagraphRatio(doc) > EMPTY_PARAGRAPH_LIMIT)
        setScale(1)
        setPhase('ready')
      } catch (err) {
        if (!alive) return
        setMessage(formatError('文档渲染失败', err))
        setPhase('error')
      }
    }

    void render()

    return () => {
      alive = false
    }
  }, [frameReady, path, attempt])

  // 窗口尺寸变化后 iframe 宽度变了，重新量一次内容高度
  useEffect(() => {
    if (phase !== 'ready') return
    const onResize = () => {
      const doc = iframeRef.current?.contentDocument
      if (doc) setContentHeight(measureHeight(doc))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [phase])

  const ready = phase === 'ready' && contentHeight > 0

  return (
    <>
      <div className="viewer-toolbar">
        <ToolbarTitle path={path} />
        <span className="toolbar-spacer" />
        <ToolbarButton
          label="缩小"
          iconOnly
          disabled={!ready || scale <= MIN_SCALE}
          onClick={() => setScale((current) => clampScale(current - SCALE_STEP))}
        >
          <ZoomOutIcon />
        </ToolbarButton>
        <button
          type="button"
          className="btn btn-ghost btn-sm viewer-zoom-label"
          title="点击恢复到 100%"
          onClick={() => setScale(1)}
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolbarButton
          label="放大"
          iconOnly
          disabled={!ready || scale >= MAX_SCALE}
          onClick={() => setScale((current) => clampScale(current + SCALE_STEP))}
        >
          <ZoomInIcon />
        </ToolbarButton>
      </div>

      {showBanner && (
        <div className="viewer-banner">
          <WarningIcon />
          <span>公式可能显示不全，以原图为准</span>
        </div>
      )}

      <div className="viewer-docx">
        {phase !== 'ready' && (
          <div className={phase === 'error' ? 'viewer-state viewer-state-error' : 'viewer-state'}>
            {phase === 'loading' ? (
              <>
                <span className="spinner" />
                <span>正在渲染文档…</span>
                <span className="viewer-state-hint">
                  复杂公式与版式可能和原文档有差异，必要时以原图为准。
                </span>
              </>
            ) : (
              <>
                <span>{message}</span>
                <ToolbarButton label="重试" onClick={() => setAttempt((current) => current + 1)}>
                  <RefreshIcon />
                  重试
                </ToolbarButton>
              </>
            )}
          </div>
        )}

        <div className="docx-scale-box" style={{ height: ready ? contentHeight * scale : 0 }}>
          <iframe
            ref={iframeRef}
            className="docx-frame"
            title="文档内容"
            sandbox="allow-same-origin"
            srcDoc={FRAME_SRCDOC}
            style={{
              height: ready ? contentHeight : 0,
              transform: `scale(${scale})`,
              visibility: ready ? 'visible' : 'hidden'
            }}
          />
        </div>
      </div>
    </>
  )
}
