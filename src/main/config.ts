import { promises as fs } from 'node:fs'
import { safeStorage } from 'electron'
import type { AppConfig, RecentDoc } from '@shared/types'
import { configPath, dataDir } from './store/paths'

interface StoredConfig {
  apiBaseUrl?: string
  apiModel?: string
  /** safeStorage 加密后的 base64；不可用时有明文回退标记 */
  apiKeyEnc?: string
  shortcut?: string
  useMock?: boolean
  recentDocs?: RecentDoc[]
}

export const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.deepseek.com',
  apiModel: 'deepseek-flash',
  shortcut: 'Alt+Shift+S',
  useMock: false
} as const

let cache: StoredConfig | null = null

async function load(): Promise<StoredConfig> {
  if (cache) return cache
  try {
    const text = await fs.readFile(configPath(), 'utf8')
    const parsed = JSON.parse(text) as StoredConfig
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

async function persist(next: StoredConfig): Promise<void> {
  cache = next
  await fs.mkdir(dataDir(), { recursive: true })
  const file = configPath()
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

function encryptKey(apiKey: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(apiKey).toString('base64')
  }
  // 极端情况下（无系统密钥环）退回 base64，仅保证不回显明文
  return `plain:${Buffer.from(apiKey, 'utf8').toString('base64')}`
}

export function decryptKey(stored: string | undefined): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export async function getConfig(): Promise<AppConfig> {
  const stored = await load()
  const key = decryptKey(stored.apiKeyEnc)
  return {
    apiBaseUrl: stored.apiBaseUrl ?? DEFAULT_CONFIG.apiBaseUrl,
    apiModel: stored.apiModel ?? DEFAULT_CONFIG.apiModel,
    hasApiKey: key.length > 0,
    shortcut: stored.shortcut ?? DEFAULT_CONFIG.shortcut,
    useMock: stored.useMock ?? DEFAULT_CONFIG.useMock,
    dataDir: dataDir(),
    recentDocs: stored.recentDocs ?? []
  }
}

export async function getApiKey(): Promise<string> {
  const stored = await load()
  return decryptKey(stored.apiKeyEnc)
}

export async function setConfig(
  patch: Partial<AppConfig> & { apiKey?: string }
): Promise<AppConfig> {
  const stored = await load()
  const next: StoredConfig = { ...stored }

  if (patch.apiBaseUrl !== undefined) next.apiBaseUrl = patch.apiBaseUrl.trim()
  if (patch.apiModel !== undefined) next.apiModel = patch.apiModel.trim()
  if (patch.shortcut !== undefined) next.shortcut = patch.shortcut.trim()
  if (patch.useMock !== undefined) next.useMock = patch.useMock
  if (patch.recentDocs !== undefined) next.recentDocs = patch.recentDocs

  if (patch.apiKey !== undefined) {
    const trimmed = patch.apiKey.trim()
    if (trimmed) next.apiKeyEnc = encryptKey(trimmed)
    else delete next.apiKeyEnc
  }

  await persist(next)
  return getConfig()
}

/** 打开文档时记录最近列表（最多 20 条，去重，新的在前） */
export async function touchRecentDoc(path: string): Promise<void> {
  const stored = await load()
  const now = new Date().toISOString()
  const list = (stored.recentDocs ?? []).filter((d) => d.path !== path)
  list.unshift({ path, openedAt: now })
  await persist({ ...stored, recentDocs: list.slice(0, 20) })
}
