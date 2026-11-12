import type { WindowApi } from '@shared/types'

/** preload 通过 contextBridge 暴露的 window.api */
export const api: WindowApi = window.api

/** 剥掉 Electron invoke 包在错误外面的 "Error invoking remote method ..." 前缀 */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const match = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]*)$/)
  return (match?.[1] ?? raw).trim()
}

/** 相对时间：刚刚 / 12 分钟前 / 今天 14:22 / 2026-11-01 */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/** 只留文件名 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** 留最后两段路径 */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join(' / ')
}

/** 截图在渲染进程里的可访问地址 */
export function imageUrl(imagePath: string | null): string {
  if (!imagePath) return ''
  const encoded = imagePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `tikuben://img/${encoded}`
}
