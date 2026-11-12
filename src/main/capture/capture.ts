import { desktopCapturer, nativeImage, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SelectionRect } from '@shared/types'
import { imagesDir } from '../store/paths'

export interface ScreenGrab {
  image: NativeImage
  display: Display
}

/**
 * 抓光标所在屏幕。
 * thumbnailSize 必须传物理像素，传小了会糊。
 */
export async function grabScreen(): Promise<ScreenGrab> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const width = Math.round(display.bounds.width * display.scaleFactor)
  const height = Math.round(display.bounds.height * display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  if (sources.length === 0) throw new Error('没有可用的屏幕源')

  // display_id 是字符串
  const matched = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const image = matched.thumbnail
  if (image.isEmpty()) throw new Error('抓屏失败：屏幕缩略图为空')
  return { image, display }
}

export function toDataUrl(image: NativeImage): string {
  return image.toDataURL()
}

/**
 * 用户拖出的选区是 CSS 坐标。用图片实际尺寸除以 CSS 视口尺寸反算，
 * 不要直接用 display.scaleFactor（缩放屏上两者不一定相等）。
 */
export function cropSelection(image: NativeImage, rect: SelectionRect): NativeImage {
  const size = image.getSize()
  if (rect.cssWidth <= 0 || rect.cssHeight <= 0) throw new Error('选区坐标无效')

  const scaleX = size.width / rect.cssWidth
  const scaleY = size.height / rect.cssHeight

  const x = Math.max(0, Math.round(rect.x * scaleX))
  const y = Math.max(0, Math.round(rect.y * scaleY))
  const width = Math.min(size.width - x, Math.round(rect.width * scaleX))
  const height = Math.min(size.height - y, Math.round(rect.height * scaleY))

  if (width <= 0 || height <= 0) throw new Error('选区太小，请重新框选')
  return image.crop({ x, y, width, height })
}

/** 长边压到 1600 以内，既省钱又避免超限 */
export function downscale(image: NativeImage, maxEdge = 1600): NativeImage {
  const { width, height } = image.getSize()
  const edge = Math.max(width, height)
  if (edge <= maxEdge) return image
  const ratio = maxEdge / edge
  return image.resize({
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    quality: 'best'
  })
}

export interface SavedCapture {
  /** 相对 data/ 目录，例如 images/8f3a.png */
  relPath: string
  width: number
  height: number
}

export async function saveCapture(image: NativeImage): Promise<SavedCapture> {
  const final = downscale(image)
  const fileName = `${randomUUID()}.png`
  await fs.mkdir(imagesDir(), { recursive: true })
  await fs.writeFile(join(imagesDir(), fileName), final.toPNG())
  const size = final.getSize()
  return { relPath: `images/${fileName}`, width: size.width, height: size.height }
}

/** 从本地图片文件导入：读出来压到长边 1600 再落盘，和截图走同一套存储 */
export async function importImageFile(sourcePath: string): Promise<SavedCapture> {
  const image = nativeImage.createFromPath(sourcePath)
  if (image.isEmpty()) throw new Error('图片读不出来，可能格式不支持')
  return saveCapture(image)
}

/** 读取图片并转 base64（识别用） */
export async function readImageBase64(absPath: string): Promise<{ base64: string; mime: string }> {
  const buf = await fs.readFile(absPath)
  const mime = absPath.toLowerCase().endsWith('.jpg') || absPath.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png'
  return { base64: buf.toString('base64'), mime }
}

export { nativeImage }
