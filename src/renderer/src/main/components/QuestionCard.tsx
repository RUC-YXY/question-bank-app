import type { Question } from '@shared/types'
import { formatTime, imageUrl } from '@renderer/shared/api'
import { Highlighted, stripMarkdown } from '@renderer/shared/Highlight'
import { MathText } from '@renderer/shared/MathMarkdown'
import { statusBadge } from '../status'
import { AlertIcon, ImageOffIcon } from './Icons'

interface QuestionCardProps {
  question: Question
  categoryName: string | null
  knowledgeNames: string[]
  keyword: string
  onOpen(question: Question): void
  onDelete(question: Question): void
}

/** 卡片标题：题干去 Markdown 后取前 80 字 */
function cardTitle(question: Question): string {
  const flat = stripMarkdown(question.stem)
  if (!flat) {
    return question.recognizing ? '正在识别题干…' : '题干还未识别'
  }
  return flat.slice(0, 80)
}

export function QuestionCard({
  question,
  categoryName,
  knowledgeNames,
  keyword,
  onOpen,
  onDelete
}: QuestionCardProps) {
  const badge = statusBadge(question)
  const shownKnowledge = knowledgeNames.slice(0, 2)
  const moreKnowledge = knowledgeNames.length - shownKnowledge.length
  /** 卡片只用第一张：题干图；其余在抽屉里看 */
  const cover = question.imagePaths[0] ?? null
  const imageCount = question.imagePaths.length

  return (
    <div
      className="question-card"
      data-question-id={question.id}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(question)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(question)
        }
      }}
    >
      <div className="card-media">
        {cover ? (
          <img src={imageUrl(cover)} alt="题目截图" loading="lazy" />
        ) : (
          <div className="card-media-placeholder">
            <ImageOffIcon />
            没有截图
          </div>
        )}

        {imageCount > 1 && (
          <span className="card-media-count" title={`这道题有 ${imageCount} 张截图`}>
            {imageCount} 张
          </span>
        )}

        <div className="card-overlay">
          {question.warnings.length > 0 && (
            <span className="card-flag" title={question.warnings.join('\n')}>
              <AlertIcon />
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm card-delete"
            title="删除这道题"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(question)
            }}
          >
            删除
          </button>
        </div>
      </div>

      <div className="card-body">
        <div className="card-title">
          {question.stem.trim() ? (
            keyword.trim() ? (
              // 搜索时用纯文本，才能把命中词标出来
              <Highlighted text={cardTitle(question)} keyword={keyword} />
            ) : (
              // 平时渲染公式，避免卡片上直接出现 \dfrac 这类源码
              <MathText source={question.stem} />
            )
          ) : (
            cardTitle(question)
          )}
        </div>

        <div className="card-meta">
          {categoryName && <span className="tag tag-accent">{categoryName}</span>}
          {shownKnowledge.map((name) => (
            <span key={name} className="tag">
              {name}
            </span>
          ))}
          {moreKnowledge > 0 && <span className="tag">+{moreKnowledge}</span>}
          <span className={`tag ${question.kind === 'wrong' ? 'tag-danger' : 'tag-ok'}`}>
            {question.kind === 'wrong' ? '错题' : '新题'}
          </span>
          <span className={`tag ${badge.className}`}>
            {badge.spinning && <i className="spinner" />}
            {badge.label}
          </span>
          <span className="card-meta-spacer" />
          <span className="card-time">{formatTime(question.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}
