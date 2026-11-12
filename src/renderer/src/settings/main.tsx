import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppConfig } from '@shared/types'
import { api, errorMessage } from '@renderer/shared/api'
import { Toaster, toast } from '@renderer/shared/toast'
import '../shared/styles.css'

/** 这些键只当修饰键，单独按下不算有效组合 */
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta']

function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.includes(key)
}

/**
 * 主键映射成 Electron accelerator 的键名。
 * 只按修饰键时返回 null，调用方据此不视为一次完整录制。
 */
function mainKeyName(event: KeyboardEvent): string | null {
  const { key } = event
  if (isModifierKey(key)) return null

  switch (key) {
    case ' ':
      return 'Space'
    case 'Escape':
      return 'Esc'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'Enter':
    case 'Backspace':
    case 'Tab':
    case 'Delete':
      return key
    default:
      break
  }

  if (/^F([1-9]|1[0-2])$/.test(key)) return key
  if (key.length === 1) return key.toUpperCase()
  return null
}

/** 组合修饰键与主键成 accelerator；至少要有一个修饰键 */
function acceleratorFromEvent(event: KeyboardEvent): string | null {
  const main = mainKeyName(event)
  if (!main) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')
  if (parts.length === 0) return null

  return [...parts, main].join('+')
}

interface FormState {
  apiBaseUrl: string
  apiModel: string
  apiKey: string
  shortcut: string
  useMock: boolean
}

const EMPTY_FORM: FormState = {
  apiBaseUrl: '',
  apiModel: '',
  apiKey: '',
  shortcut: '',
  useMock: false
}

function SettingsApp() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [recording, setRecording] = useState(false)
  const [recordHint, setRecordHint] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** 用户在表单里动过东西后，外部 config 变化不覆盖输入，避免打断正在编辑的内容 */
  const dirtyRef = useRef(false)

  const applyConfig = useCallback((next: AppConfig, resetForm: boolean): void => {
    setConfig(next)
    if (!resetForm) return
    dirtyRef.current = false
    setForm({
      apiBaseUrl: next.apiBaseUrl,
      apiModel: next.apiModel,
      // 密钥永不回显：输入框始终从空开始
      apiKey: '',
      shortcut: next.shortcut,
      useMock: next.useMock
    })
  }, [])

  const loadConfig = useCallback(
    async (resetForm: boolean): Promise<void> => {
      try {
        const next = await api.config.get()
        applyConfig(next, resetForm)
      } catch (err) {
        toast(errorMessage(err), 'error')
      }
    },
    [applyConfig]
  )

  useEffect(() => {
    void loadConfig(true)
  }, [loadConfig])

  // 配置被别处改动时重新拉取；记得退订
  useEffect(() => {
    const off = api.db.onChanged((payload) => {
      if (payload.scope !== 'config') return
      void loadConfig(!dirtyRef.current)
    })
    return () => {
      off()
    }
  }, [loadConfig])

  const update = (patch: Partial<FormState>): void => {
    dirtyRef.current = true
    setForm((prev) => ({ ...prev, ...patch }))
  }

  // 录制态接管键盘：组合有效就写入，Esc 退出
  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        setRecordHint(null)
        return
      }
      if (isModifierKey(event.key)) return

      const accelerator = acceleratorFromEvent(event)
      if (!accelerator) {
        setRecordHint('需要至少一个修饰键（Ctrl / Alt / Shift）+ 一个主键')
        return
      }

      dirtyRef.current = true
      setForm((prev) => ({ ...prev, shortcut: accelerator }))
      setRecording(false)
      setRecordHint(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording])

  const toggleRecording = (): void => {
    setRecording((prev) => !prev)
    setRecordHint(null)
  }

  const handleSave = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const patch: Partial<AppConfig> & { apiKey?: string } = {
        apiBaseUrl: form.apiBaseUrl.trim(),
        apiModel: form.apiModel.trim(),
        useMock: form.useMock
      }
      const inputKey = form.apiKey.trim()
      // 只有用户真输了新密钥才提交，留空代表保持原值
      if (inputKey) patch.apiKey = inputKey

      // 空快捷键写进配置会让截屏入口失效，这里只在有值时提交
      const nextShortcut = form.shortcut.trim()
      if (nextShortcut) patch.shortcut = nextShortcut

      const next = await api.config.set(patch)
      applyConfig(next, true)
      setRecording(false)
      setRecordHint(null)
      toast('设置已保存', 'success')
    } catch (err) {
      // 快捷键注册失败时主进程已回滚，重新拉取让界面与磁盘一致
      toast(errorMessage(err), 'error')
      void loadConfig(true)
    } finally {
      setSaving(false)
    }
  }

  const openDataDir = async (): Promise<void> => {
    if (!config) return
    try {
      await api.shell.showInFolder(config.dataDir)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const keyPlaceholder = config?.hasApiKey ? '已配置，留空表示不修改' : '粘贴 API Key'

  return (
    <>
      <div className="settings-shell">
        <h1 className="settings-title">设置</h1>
        <p className="settings-sub">配置识别接口、全局快捷键与数据目录</p>

        <section className="settings-section">
          <div className="settings-section-title">识别接口</div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">API Base URL</span>
              <input
                className="input"
                value={form.apiBaseUrl}
                placeholder="https://api.deepseek.com"
                spellCheck={false}
                onChange={(event) => update({ apiBaseUrl: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">模型名</span>
              <input
                className="input"
                value={form.apiModel}
                placeholder="deepseek-flash"
                spellCheck={false}
                onChange={(event) => update({ apiModel: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">API Key</span>
            <input
              className="input"
              type="password"
              value={form.apiKey}
              placeholder={keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => update({ apiKey: event.target.value })}
            />
            <span className="field-hint">密钥保存在本机，保存后不会再回显</span>
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">全局快捷键</div>
          <div className="field">
            <span className="field-label">截图框选</span>
            <div className="settings-actions">
              <input
                className="input"
                value={recording ? '按下组合键…' : form.shortcut}
                readOnly
                aria-label="全局快捷键"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="btn" onClick={toggleRecording}>
                {recording ? '取消录制' : '录制'}
              </button>
            </div>
            <div className="field-hint">
              {recordHint ??
                (recording
                  ? '按下组合键，例如 Alt+Shift+S；Esc 取消录制'
                  : '在其他窗口里按这个组合键可直接开始截图框选')}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">识别与数据</div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.useMock}
              onChange={(event) => update({ useMock: event.target.checked })}
            />
            <span>Mock 模式</span>
          </label>
          <div className="field-hint">开启后不调用真实接口，用内置识别结果走通流程</div>
          <div className="field">
            <span className="field-label">数据目录</span>
            <div className="mono-path">{config ? config.dataDir : '读取中…'}</div>
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!config}
                onClick={() => void openDataDir()}
              >
                打开所在文件夹
              </button>
            </div>
          </div>
        </section>

        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !config}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      <Toaster />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<SettingsApp />)
