import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import type { OverlayPayload } from '@shared/types'
import { api, errorMessage } from '@renderer/shared/api'
import '../shared/styles.css'

/** 选区最小边长：拖出或缩放小于这个值都算误操作 */
const MIN_SIZE = 8
/** 控制点的视觉边长（含 2px 描边） */
const HANDLE_SIZE = 8
/** 控制点命中半径：比视觉尺寸宽松，稍微偏一点也能抓住 */
const HANDLE_HIT_RADIUS = 8
/** 尺寸标签按自身大小预留的避让边距，避免贴到视口边缘被裁掉 */
const SIZE_LABEL_WIDTH = 96
const SIZE_LABEL_HEIGHT = 26

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Point {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 同一时刻只可能处在一种交互模式里 */
type Interaction =
  | { kind: 'idle' }
  | { kind: 'drawing'; anchor: Point }
  | { kind: 'resizing'; handle: Handle; start: Rect }
  | { kind: 'moving'; grab: Point; start: Rect }

/** 每个控制点的光标方向 */
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize'
}

/** 选中控制的顺序：角在前，控制点重叠时优先给角 */
const HANDLE_HIT_ORDER: Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e']

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** 两个点归一成左上角 + 宽高，四个方向拖拽都适用 */
function toRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/** 控制点的中心坐标，落在选区的角或边中点上 */
function handleCenter(rect: Rect, handle: Handle): Point {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2
  switch (handle) {
    case 'nw':
      return { x: rect.x, y: rect.y }
    case 'n':
      return { x: midX, y: rect.y }
    case 'ne':
      return { x: right, y: rect.y }
    case 'e':
      return { x: right, y: midY }
    case 'se':
      return { x: right, y: bottom }
    case 's':
      return { x: midX, y: bottom }
    case 'sw':
      return { x: rect.x, y: bottom }
    case 'w':
      return { x: rect.x, y: midY }
  }
}

/** 按 8px 半径找最近的控制点；角点排前面，距离相同时角优先 */
function pickHandle(rect: Rect, point: Point): Handle | null {
  let picked: Handle | null = null
  let nearest = Number.POSITIVE_INFINITY
  for (const handle of HANDLE_HIT_ORDER) {
    const center = handleCenter(rect, handle)
    const distance = Math.hypot(point.x - center.x, point.y - center.y)
    if (distance > HANDLE_HIT_RADIUS) continue
    if (distance < nearest) {
      nearest = distance
      picked = handle
    }
  }
  return picked
}

function pointInRect(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** 拖动某条边：对角固定，其余边跟着指针走，夹在视口与最小尺寸之间 */
function resizeRect(start: Rect, handle: Handle, point: Point): Rect {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (handle === 'nw' || handle === 'w' || handle === 'sw') {
    left = clamp(point.x, 0, right - MIN_SIZE)
  }
  if (handle === 'ne' || handle === 'e' || handle === 'se') {
    right = clamp(point.x, left + MIN_SIZE, viewportWidth)
  }
  if (handle === 'nw' || handle === 'n' || handle === 'ne') {
    top = clamp(point.y, 0, bottom - MIN_SIZE)
  }
  if (handle === 'sw' || handle === 's' || handle === 'se') {
    bottom = clamp(point.y, top + MIN_SIZE, viewportHeight)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 整体移动：尺寸不变，四个方向都不许移出视口 */
function moveRect(start: Rect, grab: Point, point: Point): Rect {
  const dx = clamp(
    point.x - grab.x,
    Math.min(0, -start.x),
    Math.max(0, window.innerWidth - start.x - start.width)
  )
  const dy = clamp(
    point.y - grab.y,
    Math.min(0, -start.y),
    Math.max(0, window.innerHeight - start.y - start.height)
  )
  return { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height }
}

/** 拉新选区：两端都夹到视口里，指针甩到窗口外也不会画出负坐标 */
function drawRect(anchor: Point, point: Point): Rect {
  const from = {
    x: clamp(anchor.x, 0, window.innerWidth),
    y: clamp(anchor.y, 0, window.innerHeight)
  }
  const to = {
    x: clamp(point.x, 0, window.innerWidth),
    y: clamp(point.y, 0, window.innerHeight)
  }
  return toRect(from, to)
}

function isFromToolbar(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.overlay-toolbar') !== null
}

function OverlayApp() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [mode, setMode] = useState<Interaction['kind']>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)

  /** 监听器常驻 window，靠 ref 读最新状态，避免闭包拿到旧值 */
  const payloadRef = useRef<OverlayPayload | null>(null)
  const rectRef = useRef<Rect | null>(null)
  const interactionRef = useRef<Interaction>({ kind: 'idle' })
  /** 只认按下时那个指针，多指或串号的 pointerup 直接忽略 */
  const pointerIdRef = useRef<number | null>(null)
  /** 提交或取消后窗口会被主进程关掉，标记防止重复发送 */
  const finishedRef = useRef(false)

  const applyRect = useCallback((next: Rect | null): void => {
    rectRef.current = next
    setRect(next)
  }, [])

  const cancel = useCallback((): void => {
    if (finishedRef.current) return
    finishedRef.current = true
    interactionRef.current = { kind: 'idle' }
    pointerIdRef.current = null
    api.capture.cancel()
  }, [])

  const confirm = useCallback((): void => {
    const current = rectRef.current
    if (finishedRef.current || !current) return
    // 拖拽或缩放还没收手时不提交半成品选区
    if (interactionRef.current.kind !== 'idle') return
    if (current.width < MIN_SIZE || current.height < MIN_SIZE) return
    finishedRef.current = true
    interactionRef.current = { kind: 'idle' }
    pointerIdRef.current = null
    api.capture.selected({
      x: Math.round(current.x),
      y: Math.round(current.y),
      width: Math.round(current.width),
      height: Math.round(current.height),
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight
    })
  }, [])

  useEffect(() => {
    let alive = true
    void api.capture
      .overlayPayload()
      .then((data) => {
        if (!alive) return
        if (data) {
          payloadRef.current = data
          setPayload(data)
        } else {
          setLoadError('没有拿到截图数据')
        }
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    /** 一次交互收尾：drawing 交给调用方判断成败，缩放与移动保留当前选区 */
    const endInteraction = (pointerId: number): void => {
      const interaction = interactionRef.current
      if (interaction.kind === 'idle') return
      if (pointerIdRef.current !== null && pointerIdRef.current !== pointerId) return
      pointerIdRef.current = null
      interactionRef.current = { kind: 'idle' }
      setMode('idle')

      if (interaction.kind !== 'drawing') return

      const current = rectRef.current
      const usable = current !== null && current.width >= MIN_SIZE && current.height >= MIN_SIZE
      applyRect(usable ? current : null)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if (finishedRef.current || !payloadRef.current) return
      if (isFromToolbar(event.target)) return

      const point: Point = { x: event.clientX, y: event.clientY }
      const current = rectRef.current
      const handle = current ? pickHandle(current, point) : null

      if (current && handle) {
        interactionRef.current = { kind: 'resizing', handle, start: current }
      } else if (current && pointInRect(current, point)) {
        interactionRef.current = { kind: 'moving', grab: point, start: current }
      } else {
        // 选区内部与外部都不是：重新拉一个，旧选区即刻被替换
        interactionRef.current = { kind: 'drawing', anchor: point }
        applyRect({ x: point.x, y: point.y, width: 0, height: 0 })
      }

      pointerIdRef.current = event.pointerId
      setMode(interactionRef.current.kind)
    }

    const onPointerMove = (event: PointerEvent): void => {
      const interaction = interactionRef.current
      if (interaction.kind === 'idle') return
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return

      const point: Point = { x: event.clientX, y: event.clientY }
      if (interaction.kind === 'drawing') {
        applyRect(drawRect(interaction.anchor, point))
      } else if (interaction.kind === 'resizing') {
        applyRect(resizeRect(interaction.start, interaction.handle, point))
      } else {
        applyRect(moveRect(interaction.start, interaction.grab, point))
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      endInteraction(event.pointerId)
    }

    const onPointerCancel = (event: PointerEvent): void => {
      endInteraction(event.pointerId)
    }

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      cancel()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
      }
      if (event.key !== 'Enter') return
      // 焦点已经落在按钮上时让原生 click 处理，避免 Enter 触发两次
      if (event.target instanceof HTMLElement && event.target.closest('.overlay-toolbar')) return
      event.preventDefault()
      confirm()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [applyRect, cancel, confirm])

  let selectionStyle: CSSProperties | undefined
  let sizeStyle: CSSProperties | undefined
  let sizeText = ''
  let handles: { handle: Handle; style: CSSProperties }[] = []

  if (rect) {
    selectionStyle = {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      pointerEvents: 'auto',
      cursor: 'move'
    }
  }

  if (rect && payload && rect.width > 0 && rect.height > 0) {
    sizeStyle = {
      left: clamp(rect.x + rect.width + 6, 0, window.innerWidth - SIZE_LABEL_WIDTH),
      top: clamp(rect.y + rect.height + 4, 0, window.innerHeight - SIZE_LABEL_HEIGHT)
    }
    // 视口用 CSS 像素，截图是物理像素，按图片实际尺寸换算，不要碰 devicePixelRatio
    const pixelWidth = Math.round(
      (rect.width * payload.imageWidth) / Math.max(1, window.innerWidth)
    )
    const pixelHeight = Math.round(
      (rect.height * payload.imageHeight) / Math.max(1, window.innerHeight)
    )
    sizeText = `${pixelWidth} × ${pixelHeight}`
  }

  // 拖拽出选区、或正在缩放与移动时才显示控制点；拖新选区过程中不显示，免得跟着抖动
  if (rect && mode !== 'drawing' && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
    handles = HANDLE_HIT_ORDER.map((handle) => {
      const center = handleCenter(rect, handle)
      // 贴边时把方块推回视口内，否则会被舞台裁掉一半
      const left = clamp(center.x - HANDLE_SIZE / 2, 0, window.innerWidth - HANDLE_SIZE)
      const top = clamp(center.y - HANDLE_SIZE / 2, 0, window.innerHeight - HANDLE_SIZE)
      return {
        handle,
        style: {
          position: 'absolute',
          left,
          top,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          boxSizing: 'border-box',
          background: '#ffffff',
          border: '2px solid #4d8dff',
          borderRadius: 1,
          cursor: HANDLE_CURSORS[handle],
          pointerEvents: 'auto'
        }
      }
    })
  }

  const canConfirm =
    rect !== null && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE && mode === 'idle'

  let hint: string
  if (loadError) {
    hint = `截图数据不可用：${loadError || '未知错误'} · Esc 退出`
  } else if (rect && mode !== 'drawing') {
    hint = '拖动边角调整大小 · 拖动选区内部移动位置 · Enter 或双击确认 · Esc 取消'
  } else {
    hint = '拖拽框选题目区域 · 松开后可拖动边角调整 · Enter 确认 · Esc 取消'
  }

  return (
    <>
      <div className="overlay-stage">
        {payload ? (
          <img className="overlay-shot" src={payload.screenshot} alt="" draggable={false} />
        ) : null}
        {payload && !rect ? <div className="overlay-dim" /> : null}
        {rect && selectionStyle ? (
          <div
            className="overlay-selection"
            style={selectionStyle}
            onDoubleClick={() => confirm()}
          />
        ) : null}
        {handles.map(({ handle, style }) => (
          <div key={handle} style={style} />
        ))}
        {sizeText && sizeStyle ? (
          <div className="overlay-size" style={sizeStyle}>
            {sizeText}
          </div>
        ) : null}
      </div>
      <div className="overlay-hint">{hint}</div>
      <div className="overlay-toolbar">
        <button type="button" className="btn" onClick={cancel}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={!canConfirm}>
          确认
        </button>
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<OverlayApp />)
