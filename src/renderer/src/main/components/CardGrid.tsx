import { useMemo } from 'react'
import type { Category, KnowledgePoint, Question } from '@shared/types'
import { QuestionCard } from './QuestionCard'
import { SearchIcon } from './Icons'

interface CardGridProps {
  items: Question[]
  loading: boolean
  keyword: string
  categories: Category[]
  knowledge: KnowledgePoint[]
  onOpen(question: Question): void
  onDelete(question: Question): void
}

const SKELETON_COUNT = 6

export function CardGrid({
  items,
  loading,
  keyword,
  categories,
  knowledge,
  onOpen,
  onDelete
}: CardGridProps) {
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name] as const)),
    [categories]
  )
  const knowledgeNames = useMemo(
    () => new Map(knowledge.map((item) => [item.id, item.name] as const)),
    [knowledge]
  )

  if (loading && items.length === 0) {
    return (
      <div className="card-scroll" aria-busy="true">
        <div className="card-grid">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="card-scroll">
        <div className="empty">
          <div className="empty-icon">
            <SearchIcon size={24} />
          </div>
          <div className="empty-title">还没有符合条件的题目</div>
          <div className="empty-text">
            按 <kbd className="kbd">Alt+Shift+S</kbd> 截图识别，或点右上角「打开文档」
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-scroll">
      <div className="card-grid">
        {items.map((question) => {
          const names = question.knowledgeIds
            .map((id) => knowledgeNames.get(id))
            .filter((name): name is string => typeof name === 'string')
          return (
            <QuestionCard
              key={question.id}
              question={question}
              categoryName={question.categoryId ? (categoryNames.get(question.categoryId) ?? null) : null}
              knowledgeNames={names}
              keyword={keyword}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          )
        })}
      </div>
    </div>
  )
}
