import { useEffect, useState } from 'react'
import type { Category, KnowledgePoint, QuestionOption } from '@shared/types'
import { api, errorMessage } from '@renderer/shared/api'
import { toast } from '@renderer/shared/toast'
import { MathMarkdown, MathText } from '@renderer/shared/MathMarkdown'
import { QUESTION_TYPE_OPTIONS, type DrawerFormState } from '../drawerModel'
import { ReadonlyInfo } from './ReadonlyInfo'
import { CloseIcon, PlusIcon } from './Icons'

interface DrawerFormProps {
  form: DrawerFormState
  onChange(patch: Partial<DrawerFormState>): void
  categories: Category[]
  knowledge: KnowledgePoint[]
  confidence: number
  warnings: string[]
  rawModelOutput: string
}

function nextOptionLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `选项${index + 1}`
}

export function DrawerForm({
  form,
  onChange,
  categories,
  knowledge,
  confidence,
  warnings,
  rawModelOutput
}: DrawerFormProps) {
  const [localCategories, setLocalCategories] = useState(categories)
  const [localKnowledge, setLocalKnowledge] = useState(knowledge)
  const [newCategory, setNewCategory] = useState<string | null>(null)
  const [newKnowledge, setNewKnowledge] = useState<string | null>(null)

  useEffect(() => setLocalCategories(categories), [categories])
  useEffect(() => setLocalKnowledge(knowledge), [knowledge])

  const availableKnowledge = localKnowledge.filter((item) => !form.knowledgeIds.includes(item.id))

  const updateOption = (index: number, patch: Partial<QuestionOption>): void => {
    onChange({
      options: form.options.map((option, current) =>
        current === index ? { ...option, ...patch } : option
      )
    })
  }

  const addOption = (): void => {
    const label = nextOptionLabel(form.options.length)
    onChange({ options: [...form.options, { label, text: '' }] })
  }

  const removeOption = (index: number): void => {
    onChange({ options: form.options.filter((_, current) => current !== index) })
  }

  const createCategory = async (): Promise<void> => {
    const name = (newCategory ?? '').trim()
    if (!name) return
    try {
      const created = await api.category.create(name)
      setLocalCategories((prev) => [...prev, created])
      onChange({ categoryId: created.id })
      setNewCategory(null)
      toast('分类已创建', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const createKnowledge = async (): Promise<void> => {
    const name = (newKnowledge ?? '').trim()
    if (!name) return
    try {
      const created = await api.kp.create(name)
      setLocalKnowledge((prev) => [...prev, created])
      onChange({ knowledgeIds: [...form.knowledgeIds, created.id] })
      setNewKnowledge(null)
      toast('知识点已创建', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <div className="drawer-form">
      <div className="field">
        <div className="field-label">
          题干
          <span className="field-hint">支持 Markdown，公式用 $...$ 或 $$...$$</span>
        </div>
        <div className="split-preview">
          <textarea
            className="textarea"
            value={form.stem}
            onChange={(event) => onChange({ stem: event.target.value })}
            placeholder="在这里输入或粘贴题干"
            aria-label="题干"
          />
          <div className="preview-box">
            {form.stem.trim() ? <MathMarkdown source={form.stem} /> : null}
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          选项
          <span className="field-hint">选择题用，其它题型可以留空</span>
        </div>
        <div className="option-list">
          {form.options.map((option, index) => (
            <div className="option-item" key={index}>
              <div className="option-row">
                <input
                  className="input option-label"
                  value={option.label}
                  onChange={(event) => updateOption(index, { label: event.target.value })}
                  aria-label={`第 ${index + 1} 个选项的标签`}
                />
                <input
                  className="input"
                  value={option.text}
                  onChange={(event) => updateOption(index, { text: event.target.value })}
                  placeholder={`选项 ${option.label || index + 1} 的内容`}
                  aria-label={`第 ${index + 1} 个选项的内容`}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  title="删除这个选项"
                  onClick={() => removeOption(index)}
                >
                  <CloseIcon />
                </button>
              </div>
              {option.text.trim() && (
                <div className="option-preview">
                  <MathText source={option.text} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="btn btn-sm" onClick={addOption}>
            <PlusIcon />
            添加选项
          </button>
        </div>
      </div>

      <div className="field">
        <div className="field-label">答案</div>
        <input
          className="input"
          value={form.answer}
          onChange={(event) => onChange({ answer: event.target.value })}
          placeholder="例如 B，或一个表达式"
          aria-label="答案"
        />
      </div>

      <div className="field">
        <div className="field-label">
          解析
          <span className="field-hint">支持 Markdown，公式用 $...$</span>
        </div>
        <div className="split-preview">
          <textarea
            className="textarea textarea-short"
            value={form.analysis}
            onChange={(event) => onChange({ analysis: event.target.value })}
            placeholder="解题思路、易错点"
            aria-label="解析"
          />
          <div className="preview-box">
            {form.analysis.trim() ? <MathMarkdown source={form.analysis} /> : null}
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field-label">分类</div>
        <div className="inline-row">
          <select
            className="select"
            aria-label="分类"
            value={form.categoryId ?? ''}
            onChange={(event) =>
              onChange({ categoryId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">未分类</option>
            {localCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          {newCategory === null ? (
            <button type="button" className="btn btn-sm" onClick={() => setNewCategory('')}>
              <PlusIcon />
              新建分类
            </button>
          ) : (
            <div className="inline-input">
              <input
                className="input"
                autoFocus
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="新分类名称"
                aria-label="新分类名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createCategory()
                  }
                  if (event.key === 'Escape') setNewCategory(null)
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void createCategory()}
              >
                确定
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewCategory(null)}>
                取消
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <div className="field-label">知识点</div>
        <div className="chip-group">
          {form.knowledgeIds.map((id) => {
            const item = localKnowledge.find((entry) => entry.id === id)
            return (
              <span key={id} className="chip active">
                {item ? item.name : '未知知识点'}
                <span
                  className="chip-x"
                  role="button"
                  tabIndex={0}
                  title="移除这个知识点"
                  onClick={() =>
                    onChange({ knowledgeIds: form.knowledgeIds.filter((entry) => entry !== id) })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onChange({ knowledgeIds: form.knowledgeIds.filter((entry) => entry !== id) })
                    }
                  }}
                >
                  ×
                </span>
              </span>
            )
          })}
          {form.knowledgeIds.length === 0 && <span className="field-hint">还没有选中知识点</span>}
        </div>

        {availableKnowledge.length > 0 && (
          <div className="chip-group">
            {availableKnowledge.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chip"
                title={`添加「${item.name}」`}
                onClick={() => onChange({ knowledgeIds: [...form.knowledgeIds, item.id] })}
              >
                + {item.name}
              </button>
            ))}
          </div>
        )}

        <div>
          {newKnowledge === null ? (
            <button type="button" className="btn btn-sm" onClick={() => setNewKnowledge('')}>
              <PlusIcon />
              新建知识点
            </button>
          ) : (
            <div className="inline-input">
              <input
                className="input"
                autoFocus
                value={newKnowledge}
                onChange={(event) => setNewKnowledge(event.target.value)}
                placeholder="新知识点名称"
                aria-label="新知识点名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createKnowledge()
                  }
                  if (event.key === 'Escape') setNewKnowledge(null)
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void createKnowledge()}
              >
                确定
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setNewKnowledge(null)}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <div className="field-label">错题 / 新题</div>
        <div className="chip-group">
          <button
            type="button"
            className={`chip${form.kind === 'wrong' ? ' active' : ''}`}
            onClick={() => onChange({ kind: 'wrong' })}
          >
            错题
          </button>
          <button
            type="button"
            className={`chip${form.kind === 'new' ? ' active' : ''}`}
            onClick={() => onChange({ kind: 'new' })}
          >
            新题
          </button>
        </div>
      </div>

      <div className="field">
        <div className="field-label">题型</div>
        <select
          className="select"
          aria-label="题型"
          value={form.questionType}
          onChange={(event) =>
            onChange({ questionType: event.target.value as DrawerFormState['questionType'] })
          }
        >
          {QUESTION_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <ReadonlyInfo confidence={confidence} warnings={warnings} rawModelOutput={rawModelOutput} />
    </div>
  )
}
