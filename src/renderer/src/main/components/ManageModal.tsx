import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Category, KnowledgePoint } from '@shared/types'
import { api, errorMessage } from '@renderer/shared/api'
import { toast } from '@renderer/shared/toast'
import { CloseIcon, PlusIcon } from './Icons'

interface ManageModalProps {
  categories: Category[]
  knowledge: KnowledgePoint[]
  onClose(): void
}

type TargetKind = 'category' | 'kp'
interface EditingTarget {
  kind: TargetKind
  id: string
}

export function ManageModal({ categories, knowledge, onClose }: ManageModalProps) {
  const [editing, setEditing] = useState<EditingTarget | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newKnowledge, setNewKnowledge] = useState('')

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const startEdit = (kind: TargetKind, id: string, name: string): void => {
    setEditing({ kind, id })
    setEditValue(name)
  }

  const submitRename = async (): Promise<void> => {
    if (!editing) return
    const name = editValue.trim()
    if (!name) {
      setEditing(null)
      return
    }
    try {
      if (editing.kind === 'category') await api.category.rename(editing.id, name)
      else await api.kp.rename(editing.id, name)
      toast('已重命名', 'success')
      setEditing(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const removeCategory = async (category: Category): Promise<void> => {
    if (!window.confirm(`删除分类「${category.name}」？该分类下的题目会变成未分类。`)) return
    try {
      await api.category.delete(category.id)
      toast('分类已删除', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const removeKnowledge = async (item: KnowledgePoint): Promise<void> => {
    if (!window.confirm(`删除知识点「${item.name}」？它会从所有题目里移除。`)) return
    try {
      await api.kp.delete(item.id)
      toast('知识点已删除', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const createCategory = useCallback(async (): Promise<void> => {
    const name = newCategory.trim()
    if (!name) return
    try {
      await api.category.create(name)
      setNewCategory('')
      toast('分类已创建', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [newCategory])

  const createKnowledge = useCallback(async (): Promise<void> => {
    const name = newKnowledge.trim()
    if (!name) return
    try {
      await api.kp.create(name)
      setNewKnowledge('')
      toast('知识点已创建', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }, [newKnowledge])

  const renderRow = (kind: TargetKind, id: string, name: string) => {
    const isEditing = editing !== null && editing.kind === kind && editing.id === id

    if (isEditing) {
      return (
        <div className="manage-row">
          <input
            className="input"
            autoFocus
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            aria-label="新名称"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitRename()
              }
              if (event.key === 'Escape') setEditing(null)
            }}
          />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void submitRename()}>
            保存
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
            取消
          </button>
        </div>
      )
    }

    return (
      <div className="manage-row">
        <span className="manage-name" title={name}>
          {name}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => startEdit(kind, id, name)}
        >
          重命名
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => {
            if (kind === 'category') {
              const target = categories.find((category) => category.id === id)
              if (target) void removeCategory(target)
            } else {
              const target = knowledge.find((item) => item.id === id)
              if (target) void removeKnowledge(target)
            }
          }}
        >
          删除
        </button>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="分类与知识点管理" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <span className="modal-title">分类与知识点管理</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="关闭">
            <CloseIcon />
          </button>
        </header>

        <div className="modal-body">
          <section className="manage-section">
            <div className="manage-section-title">
              <span>分类（{categories.length}）</span>
            </div>
            <div className="manage-list">
              {categories.length === 0 && <div className="manage-empty">还没有分类</div>}
              {categories.map((category) => (
                <Fragment key={category.id}>
                  {renderRow('category', category.id, category.name)}
                </Fragment>
              ))}
            </div>
            <div className="manage-create">
              <input
                className="input"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="新建分类名称"
                aria-label="新建分类名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createCategory()
                  }
                }}
              />
              <button type="button" className="btn btn-sm" onClick={() => void createCategory()}>
                <PlusIcon />
                添加
              </button>
            </div>
          </section>

          <section className="manage-section">
            <div className="manage-section-title">
              <span>知识点（{knowledge.length}）</span>
            </div>
            <div className="manage-list">
              {knowledge.length === 0 && <div className="manage-empty">还没有知识点</div>}
              {knowledge.map((item) => (
                <Fragment key={item.id}>{renderRow('kp', item.id, item.name)}</Fragment>
              ))}
            </div>
            <div className="manage-create">
              <input
                className="input"
                value={newKnowledge}
                onChange={(event) => setNewKnowledge(event.target.value)}
                placeholder="新建知识点名称"
                aria-label="新建知识点名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createKnowledge()
                  }
                }}
              />
              <button type="button" className="btn btn-sm" onClick={() => void createKnowledge()}>
                <PlusIcon />
                添加
              </button>
            </div>
          </section>
        </div>

        <footer className="modal-footer">
          <span className="field-hint">重命名与删除会立即生效，也会同步更新题目上的标记</span>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
