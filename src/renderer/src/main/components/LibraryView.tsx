import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category, KnowledgePoint, Question } from '@shared/types'
import { api, errorMessage, formatTime } from '@renderer/shared/api'
import { MathMarkdown, MathText } from '@renderer/shared/MathMarkdown'
import { toast } from '@renderer/shared/toast'
import { ChevronDownIcon, SearchIcon } from './Icons'
import '../library.css'

type ExportFormat = 'md' | 'docx' | 'pdf'

/** 主窗口里的「题库」视图：批量查看与导出，不显示 LaTeX 源码和原始截图 */
export function LibraryView() {
  const [items, setItems] = useState<Question[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [knowledge, setKnowledge] = useState<KnowledgePoint[]>([])
  const [keyword, setKeyword] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 展开了解析的题目 id */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, facets] = await Promise.all([
        api.question.list({ offset: 0, limit: 500, keyword: '', kind: 'all', status: 'confirmed' }),
        api.question.facets()
      ])
      setItems(list.items)
      setCategories(facets.categories)
      setKnowledge(facets.knowledge)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const off = api.db.onChanged(() => void load())
    return off
  }, [load])

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return items.filter((question) => {
      if (categoryId && question.categoryId !== categoryId) return false
      if (!needle) return true
      const haystack = [
        question.stem,
        question.answer,
        question.analysis,
        ...question.options.map((option) => option.text)
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [items, keyword, categoryId])

  const allSelected = filtered.length > 0 && filtered.every((question) => selected.has(question.id))

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((question) => question.id)))
  }

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exportAs = async (format: ExportFormat): Promise<void> => {
    const ids = selected.size > 0 ? [...selected] : filtered.map((question) => question.id)
    if (ids.length === 0) {
      toast('没有可导出的题目', 'error')
      return
    }
    setBusy(true)
    try {
      const path = await api.library.exportQuestions(ids, format)
      if (path) toast(`已导出 ${ids.length} 道题到 ${path}`, 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const editQuestion = async (id: string): Promise<void> => {
    try {
      await api.app.focusQuestion(id)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  const categoryName = (id: string | null): string | null =>
    id ? (categories.find((item) => item.id === id)?.name ?? null) : null

  const knowledgeNames = (ids: string[]): string[] =>
    ids
      .map((id) => knowledge.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name))

  return (
    <div className="library-view">
      <div className="library-toolbar">
        <div className="search-box">
          <SearchIcon />
          <input
            className="input"
            placeholder="搜索题干、答案、解析"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <select
          className="select"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">全部分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <span className="toolbar-spacer" />
        <span className="library-count">共 {filtered.length} 道</span>

        <button type="button" className="btn btn-sm" onClick={toggleAll} disabled={filtered.length === 0}>
          {allSelected ? '取消全选' : '全选'}
        </button>
        <span className="library-selected">已选 {selected.size} 道</span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void exportAs('md')}
          disabled={busy}
        >
          导出 Markdown
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void exportAs('docx')} disabled={busy}>
          导出 Word
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void exportAs('pdf')} disabled={busy}>
          导出 PDF
        </button>
      </div>

      <div className="library-list">
        {loading && (
          <div className="empty">
            <span className="spinner" />
            <span>加载中…</span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="empty">
            <div className="empty-title">没有符合条件的题目</div>
            <div className="empty-text">先在「录入」页录入题目，再回到这里查看</div>
          </div>
        )}

        {!loading &&
          filtered.map((question, index) => {
            const category = categoryName(question.categoryId)
            const points = knowledgeNames(question.knowledgeIds)
            return (
              <div
                className={`library-item${selected.has(question.id) ? ' selected' : ''}`}
                key={question.id}
              >
                <label className="library-check">
                  <input
                    type="checkbox"
                    checked={selected.has(question.id)}
                    onChange={() => toggleOne(question.id)}
                    aria-label={`选择第 ${index + 1} 道题`}
                  />
                </label>

                <div className="library-body">
                  <div className="library-meta">
                    <span className="library-index">{index + 1}</span>
                    <span className={`tag ${question.kind === 'wrong' ? 'tag-danger' : 'tag-ok'}`}>
                      {question.kind === 'wrong' ? '错题' : '新题'}
                    </span>
                    {category && <span className="tag tag-accent">{category}</span>}
                    {points.map((name) => (
                      <span className="tag" key={name}>
                        {name}
                      </span>
                    ))}
                    <span className="card-time">{formatTime(question.updatedAt)}</span>
                  </div>

                  <div className="library-stem">
                    <MathText source={question.stem} />
                  </div>

                  {question.options.length > 0 && (
                    <div className="library-options">
                      {question.options.map((option) => (
                        <div className="library-option" key={option.label}>
                          {option.label}. <MathText source={option.text} />
                        </div>
                      ))}
                    </div>
                  )}

                  {question.answer && (
                    <div className="library-answer">
                      答案：<MathText source={question.answer} />
                    </div>
                  )}

                  {question.analysis.trim() && (
                    <div className="library-analysis-wrap">
                      <button
                        type="button"
                        className={`library-expand${expanded.has(question.id) ? ' open' : ''}`}
                        onClick={() => toggleExpand(question.id)}
                        aria-expanded={expanded.has(question.id)}
                      >
                        <ChevronDownIcon size={12} />
                        {expanded.has(question.id) ? '收起解析' : '展开解析'}
                      </button>
                      {expanded.has(question.id) && (
                        <div className="library-analysis">
                          <div className="library-analysis-label">解析</div>
                          <MathMarkdown source={question.analysis} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-sm library-edit"
                  onClick={() => void editQuestion(question.id)}
                >
                  修改
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}
