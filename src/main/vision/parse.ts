import type { RawRecognizedQuestion, QuestionOption, QuestionType, RecognitionResult } from '@shared/types'

const QUESTION_TYPES: QuestionType[] = ['choice', 'fill', 'solve']

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 模型偶尔会用 \(...\) 和 \[...\] 写公式，渲染层只认 $...$ 与 $$...$$，
 * 这里统一成后者，免得预览里显示一堆反斜杠。
 */
function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, tex: string) => `$$${tex}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, tex: string) => `$${tex}$`)
}

function normalizeOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const label = str(rec.label).trim()
      const text = str(rec.text).trim()
      if (!label && !text) return null
      return { label: label || '?', text }
    })
    .filter((o): o is QuestionOption => o !== null)
}

function normalizeType(value: unknown, options: QuestionOption[]): QuestionType {
  const raw = str(value).trim().toLowerCase()
  if (QUESTION_TYPES.includes(raw as QuestionType)) return raw as QuestionType
  return options.length > 0 ? 'choice' : 'solve'
}

function clampConfidence(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 0.5
  return Math.min(1, Math.max(0, num))
}

/** 从模型返回的 content 里剥出 JSON：先直接 parse，再剥 ```json 围栏。 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('模型返回为空')

  try {
    return JSON.parse(trimmed)
  } catch {
    /* 继续尝试围栏 */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim())
  }

  // 最后一道：截取第一个 { 到最后一个 }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new Error('模型返回不是合法 JSON')
}

/**
 * 校验并修复模型输出。任何一条不合格只丢弃该条并写 warning，不整批失败。
 */
export function parseRecognition(content: string): RecognitionResult {
  const parsed = extractJson(content) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') throw new Error('模型返回结构不是对象')

  const topWarnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === 'string')
    : []

  const rawList = Array.isArray(parsed.questions) ? parsed.questions : []
  const questions: RawRecognizedQuestion[] = []
  const warnings = [...topWarnings]

  rawList.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      warnings.push(`第 ${index + 1} 条不是对象，已丢弃`)
      return
    }
    const rec = item as Record<string, unknown>
    const stem = normalizeMathDelimiters(str(rec.stem).trim())
    if (!stem) {
      warnings.push(`第 ${index + 1} 条题干为空，已丢弃`)
      return
    }
    const options = normalizeOptions(rec.options).map((option) => ({
      ...option,
      text: normalizeMathDelimiters(option.text)
    }))
    const itemWarnings = Array.isArray(rec.warnings)
      ? rec.warnings.filter((w): w is string => typeof w === 'string')
      : []
    questions.push({
      stem,
      options,
      answer: normalizeMathDelimiters(str(rec.answer).trim()),
      analysis: normalizeMathDelimiters(str(rec.analysis).trim()),
      questionType: normalizeType(rec.questionType, options),
      confidence: clampConfidence(rec.confidence),
      warnings: itemWarnings
    })
  })

  return { questions, warnings, raw: content, provider: 'api' }
}
