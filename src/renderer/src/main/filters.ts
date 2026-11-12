import type { QuestionFilter } from '@shared/types'

/** 工具栏筛选状态。keyword 走防抖单独保存，不放在这里 */
export type KindFilter = 'all' | 'wrong' | 'new'
export type StatusFilter = 'all' | 'draft' | 'confirmed'
export type DateRange = 'all' | 'today' | 'week' | 'month'
export type KnowledgeMode = 'all' | 'any'

export interface FilterState {
  categoryId: string
  knowledgeIds: string[]
  knowledgeMode: KnowledgeMode
  kind: KindFilter
  status: StatusFilter
  range: DateRange
}

export const EMPTY_FILTER: FilterState = {
  categoryId: '',
  knowledgeIds: [],
  knowledgeMode: 'all',
  kind: 'all',
  status: 'all',
  range: 'all'
}

/** 一次拉取上限，超过时界面提示只显示前 N 条 */
export const PAGE_LIMIT = 200

export const KIND_OPTIONS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: 'all', label: '全部题目' },
  { value: 'wrong', label: '错题' },
  { value: 'new', label: '新题' }
]

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '待确认' },
  { value: 'confirmed', label: '已入库' }
]

export const RANGE_OPTIONS: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '近 30 天' }
]

/**
 * 时间范围换算成 ISO 字符串。
 * 主进程按字符串比较 createdAt，两侧格式必须一致（都是 toISOString 的结果）。
 */
export function dateFromOf(range: DateRange): string | undefined {
  if (range === 'all') return undefined
  if (range === 'today') {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  }
  const days = range === 'week' ? 7 : 30
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export function buildQuestionFilter(state: FilterState, keyword: string): QuestionFilter {
  return {
    keyword: keyword.trim(),
    categoryIds: state.categoryId ? [state.categoryId] : [],
    knowledgeIds: state.knowledgeIds,
    knowledgeMode: state.knowledgeMode,
    kind: state.kind,
    status: state.status,
    dateFrom: dateFromOf(state.range),
    offset: 0,
    limit: PAGE_LIMIT
  }
}
