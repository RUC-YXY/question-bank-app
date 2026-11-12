import type { Question } from '@shared/types'

export interface StatusBadge {
  label: string
  className: string
  spinning: boolean
}

/** 卡片与抽屉里的状态标记，判定顺序固定：已入库 → 识别中 → 待识别 → 待确认 */
export function statusBadge(question: Question): StatusBadge {
  if (question.status === 'confirmed') {
    return { label: '已入库', className: 'tag-ok', spinning: false }
  }
  if (question.recognizing) {
    return { label: '识别中', className: 'tag-accent', spinning: true }
  }
  if (question.stem.trim().length === 0) {
    return { label: '待识别', className: 'tag-warn', spinning: false }
  }
  return { label: '待确认', className: 'tag-warn', spinning: false }
}
