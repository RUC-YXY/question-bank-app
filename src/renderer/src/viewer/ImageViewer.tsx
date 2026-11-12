import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { api, baseName } from '@renderer/shared/api'
import { WidthIcon, ZoomInIcon, ZoomOutIcon } from './icons'
import { ToolbarButton, formatError } from './ui'

const MIN_SCALE = 0.1
const MAX_SCALE = 6

interface ImageViewerProps {
  path: string
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'svg') return 'image/svg+xml'
  return 'image/png'
}

/** 拖进来的图片：只做查看与缩放，识别和录入交给截图流程 */
export function ImageViewer({ path }: ImageViewerProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [naturalWidth, setNaturalWidth] = useState(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    setUrl('')
    setError('')
    setNaturalWidth(0)

    void (async () => {
      try {
        const bytes = await api.doc.readFile(path)
        if (!alive) return
        // 复制一份，避免 Uint8Array<ArrayBufferLike> 与 BlobPart 的类型冲突
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeOf(path) }))
        setUrl(objectUrl)
      } catch (err) {
        if (alive) setError(formatError('打开图片失败', err))
      }
    })()

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  const fitWidth = useCallback((): void => {
    const area = areaRef.current
    const image = imgRef.current
    if (!area || !image || image.naturalWidth <= 0) return
    const available = area.clientWidth - 36
    if (available <= 0) return
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / image.naturalWidth)))
  }, [])

  const onLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const image = event.currentTarget
    setNaturalWidth(image.naturalWidth)
    const area = areaRef.current
    if (area && image.naturalWidth > 0) {
      const available = area.clientWidth - 36
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / image.naturalWidth)))
    }
  }

  const zoomBy = (delta: number): void => {
    setScale((prev) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((prev + delta) * 100) / 100))
    )
  }

  return (
    <>
      <div className="viewer-toolbar">
        <span className="viewer-title" title={path}>
          {baseName(path)}
        </span>
        <span className="toolbar-spacer" />
        <ToolbarButton label="缩小" iconOnly disabled={scale <= MIN_SCALE} onClick={() => zoomBy(-0.1)}>
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
        <ToolbarButton label="放大" iconOnly disabled={scale >= MAX_SCALE} onClick={() => zoomBy(0.1)}>
          <ZoomInIcon />
        </ToolbarButton>
        <ToolbarButton label="适应宽度" iconOnly onClick={fitWidth}>
          <WidthIcon />
        </ToolbarButton>
      </div>

      {error && (
        <div className="viewer-banner">
          <span>{error}</span>
        </div>
      )}

      <div className="viewer-canvas-area image-viewer-area" ref={areaRef}>
        {!url && !error && (
          <div className="viewer-state">
            <span className="spinner" />
            <span>正在打开图片…</span>
          </div>
        )}
        {url && (
          <img
            ref={imgRef}
            src={url}
            alt={baseName(path)}
            draggable={false}
            style={naturalWidth > 0 ? { width: `${Math.round(naturalWidth * scale)}px` } : undefined}
            onLoad={onLoad}
          />
        )}
      </div>
    </>
  )
}
