import type { Question, QuestionFilter } from '@shared/types'

function haystack(q: Question): string {
  return [q.stem, q.answer, q.analysis, ...q.options.map((o) => `${o.label} ${o.text}`)]
    .join(' ')
    .toLowerCase()
}

/**
 * 内存索引与筛选。题库规模在几千条以内，线性扫描足够；
 * 关键词预小写，避免每条重复 toLowerCase。
 */
export function filterQuestions(items: Question[], filter: QuestionFilter): Question[] {
  const keyword = filter.keyword?.trim().toLowerCase() ?? ''
  const categoryIds = filter.categoryIds?.filter(Boolean) ?? []
  const knowledgeIds = filter.knowledgeIds?.filter(Boolean) ?? []
  const knowledgeMode = filter.knowledgeMode ?? 'all'

  const out = items.filter((q) => {
    if (keyword && !haystack(q).includes(keyword)) return false

    if (categoryIds.length > 0) {
      if (!q.categoryId || !categoryIds.includes(q.categoryId)) return false
    }

    if (knowledgeIds.length > 0) {
      const hit =
        knowledgeMode === 'any'
          ? knowledgeIds.some((id) => q.knowledgeIds.includes(id))
          : knowledgeIds.every((id) => q.knowledgeIds.includes(id))
      if (!hit) return false
    }

    if (filter.kind && filter.kind !== 'all' && q.kind !== filter.kind) return false
    if (filter.status && filter.status !== 'all' && q.status !== filter.status) return false

    if (filter.dateFrom && q.createdAt < filter.dateFrom) return false
    if (filter.dateTo && q.createdAt > filter.dateTo) return false

    return true
  })

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return out
}

/** 关键词高亮用的纯文本片段（题干可能是 Markdown，高亮由渲染层处理） */
export function matchPreview(q: Question, keyword: string): string {
  const kw = keyword.trim()
  if (!kw) return q.stem
  const flat = q.stem.replace(/[#*`$]/g, '').replace(/\s+/g, ' ')
  const idx = flat.toLowerCase().indexOf(kw.toLowerCase())
  if (idx < 0) return flat
  const start = Math.max(0, idx - 20)
  return `${start > 0 ? '…' : ''}${flat.slice(start, idx + kw.length + 40)}`
}
