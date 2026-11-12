import type {
  Question,
  QuestionKind,
  QuestionOption,
  QuestionSource,
  QuestionType
} from '@shared/types'

/** 抽屉里可编辑的字段 */
export interface DrawerFormState {
  kind: QuestionKind
  questionType: QuestionType
  stem: string
  options: QuestionOption[]
  answer: string
  analysis: string
  categoryId: string | null
  knowledgeIds: string[]
}

/** 抽屉里的只读信息：截图、识别置信度、警告与原始输出 */
export interface DrawerMeta {
  imagePaths: string[]
  rawModelOutput: string
  confidence: number
  warnings: string[]
  source: QuestionSource
}

export const QUESTION_TYPE_OPTIONS: ReadonlyArray<{ value: QuestionType; label: string }> = [
  { value: 'choice', label: '选择题' },
  { value: 'fill', label: '填空题' },
  { value: 'solve', label: '解答题' }
]

export const KIND_OPTIONS: ReadonlyArray<{ value: QuestionKind; label: string }> = [
  { value: 'wrong', label: '错题' },
  { value: 'new', label: '新题' }
]

export function formFromQuestion(question: Question): DrawerFormState {
  return {
    kind: question.kind,
    questionType: question.questionType,
    stem: question.stem,
    options: question.options.map((option) => ({ label: option.label, text: option.text })),
    answer: question.answer,
    analysis: question.analysis,
    categoryId: question.categoryId,
    knowledgeIds: [...question.knowledgeIds]
  }
}

export function metaFromQuestion(question: Question): DrawerMeta {
  return {
    imagePaths: [...question.imagePaths],
    rawModelOutput: question.rawModelOutput,
    confidence: question.confidence,
    warnings: question.warnings,
    source: question.source
  }
}

/** 保存并继续录入后用的空表单：保留题目类型与错题/新题，清空内容与归类 */
export function emptyForm(kind: QuestionKind, questionType: QuestionType): DrawerFormState {
  return {
    kind,
    questionType,
    stem: '',
    options: [],
    answer: '',
    analysis: '',
    categoryId: null,
    knowledgeIds: []
  }
}

export function emptyMeta(): DrawerMeta {
  return {
    imagePaths: [],
    rawModelOutput: '',
    confidence: 0,
    warnings: [],
    source: { capturedAt: new Date().toISOString() }
  }
}
