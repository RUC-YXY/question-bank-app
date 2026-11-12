import { globalShortcut } from 'electron'

let current = ''

export interface RegisterResult {
  ok: boolean
  message?: string
}

/** 注册全局快捷键；失败（被占用/格式非法）返回原因，不抛异常。 */
export function registerShortcut(accelerator: string, onTrigger: () => void): RegisterResult {
  const trimmed = accelerator.trim()
  if (!trimmed) return { ok: false, message: '快捷键不能为空' }

  unregisterShortcut()
  try {
    const ok = globalShortcut.register(trimmed, onTrigger)
    if (!ok) return { ok: false, message: `快捷键 ${trimmed} 被其他程序占用，请换一个` }
    current = trimmed
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `快捷键格式不合法：${(err as Error).message}` }
  }
}

export function unregisterShortcut(): void {
  if (current && globalShortcut.isRegistered(current)) {
    globalShortcut.unregister(current)
  }
  current = ''
}

export function currentShortcut(): string {
  return current
}
