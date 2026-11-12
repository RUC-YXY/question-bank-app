import { useEffect, useRef, useState } from 'react'
import type { KnowledgePoint } from '@shared/types'
import type { KnowledgeMode } from '../filters'
import { ChevronDownIcon, TagIcon } from './Icons'

interface KnowledgePickerProps {
  items: KnowledgePoint[]
  selectedIds: string[]
  mode: KnowledgeMode
  onChange(ids: string[]): void
  onModeChange(mode: KnowledgeMode): void
}

export function KnowledgePicker({
  items,
  selectedIds,
  mode,
  onChange,
  onModeChange
}: KnowledgePickerProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const label = selectedIds.length > 0 ? `知识点 · ${selectedIds.length}` : '知识点'

  useEffect(() => {
    if (!open) return
    const handleDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrapRef.current && !wrapRef.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [open])

  const toggle = (id: string, checked: boolean): void => {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((item) => item !== id))
  }

  return (
    <div className="kp-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn${selectedIds.length > 0 ? ' kp-trigger-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="按知识点筛选"
      >
        <TagIcon />
        {label}
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="kp-panel" role="dialog" aria-label="知识点筛选">
          <div className="kp-panel-head">
            <span>知识点筛选</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={selectedIds.length === 0}
              onClick={() => onChange([])}
            >
              清空
            </button>
          </div>

          <div className="kp-options">
            {items.length === 0 && (
              <div className="kp-empty">还没有知识点，可在编辑抽屉或「管理」里新建</div>
            )}
            {items.map((item) => (
              <label key={item.id} className="checkbox kp-option">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={(event) => toggle(item.id, event.target.checked)}
                />
                <span>{item.name}</span>
              </label>
            ))}
          </div>

          <div className="kp-panel-foot">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={mode === 'any'}
                onChange={(event) => onModeChange(event.target.checked ? 'any' : 'all')}
              />
              任一匹配
            </label>
            <span className="field-hint">
              {mode === 'any' ? '命中任意一个知识点即显示' : '需同时命中全部已选知识点'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
