import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import type { Category, KnowledgePoint, Question } from '@shared/types'
import { injectOmml, splitMath } from './export/math'

const KIND_LABEL: Record<Question['kind'], string> = {
  wrong: '错题',
  new: '新题'
}

/** LaTeX 里的常见符号，Word 里没法直接排版公式，先转成 Unicode 保证可读 */
const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  Omega: 'Ω',
  Gamma: 'Γ',
  infty: '∞',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  mp: '∓',
  approx: '≈',
  equiv: '≡',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftrightarrow: '⇔',
  sum: '∑',
  int: '∫',
  sqrt: '√',
  angle: '∠',
  triangle: '△',
  perp: '⊥',
  parallel: '∥',
  because: '∵',
  therefore: '∴',
  ldots: '…',
  cdots: '⋯',
  quad: ' ',
  qquad: '  ',
  left: '',
  right: ''
}

function latexToPlain(tex: string): string {
  let out = tex
  out = out.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  out = out.replace(/\\sqrt\[[^\]]*\]\{([^{}]*)\}/g, '√[$1]')
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
  out = out.replace(/\\text\{([^{}]*)\}/g, '$1')
  out = out.replace(/\\mathbb\{([A-Z])\}/g, (_m, letter: string) => {
    const map: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' }
    return map[letter] ?? letter
  })
  out = out.replace(/\\([a-zA-Z]+)/g, (match, name: string) => SYMBOLS[name] ?? match)
  out = out.replace(/\\[,;:!]/g, ' ')
  out = out.replace(/[{}$]/g, '')
  return out.replace(/\s+/g, ' ').trim()
}

function collectTags(
  question: Question,
  categories: Map<string, string>,
  knowledge: Map<string, string>
): string[] {
  const tags: string[] = []
  if (question.categoryId) {
    const name = categories.get(question.categoryId)
    if (name) tags.push(name)
  }
  for (const id of question.knowledgeIds) {
    const name = knowledge.get(id)
    if (name) tags.push(name)
  }
  return tags
}

/** Markdown 导出：保留原始 LaTeX，方便再导入别的工具 */
export function buildMarkdown(
  questions: Question[],
  categories: Category[],
  knowledge: KnowledgePoint[]
): string {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]))
  const knowledgeMap = new Map(knowledge.map((item) => [item.id, item.name]))
  const now = new Date().toLocaleString('zh-CN')
  const lines: string[] = [
    '# 题库导出',
    '',
    `导出时间：${now}　共 ${questions.length} 道题`,
    ''
  ]

  questions.forEach((question, index) => {
    const tags = collectTags(question, categoryMap, knowledgeMap)
    const title = `${index + 1}. ${KIND_LABEL[question.kind]}${tags.length > 0 ? `　${tags.join(' · ')}` : ''}`
    lines.push(`## ${title}`, '')
    lines.push(question.stem, '')
    for (const option of question.options) {
      lines.push(`- ${option.label}. ${option.text}`)
    }
    if (question.options.length > 0) lines.push('')
    if (question.answer) lines.push(`**答案：** ${question.answer}`, '')
    if (question.analysis) lines.push('**解析：**', '', question.analysis, '')
    lines.push('---', '')
  })

  return lines.join('\n')
}

/** Word 导出：公式转成 OMML（Word 原生公式），可以在 Word 里直接编辑 */
export async function buildDocx(
  questions: Question[],
  categories: Category[],
  knowledge: KnowledgePoint[]
): Promise<Buffer> {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]))
  const knowledgeMap = new Map(knowledge.map((item) => [item.id, item.name]))
  const children: Paragraph[] = []
  /** 公式 OMML 按出现顺序存，正文里写占位符，打包后再替换 */
  const mathParts: string[] = []

  interface RichOptions {
    size?: number
    color?: string
    indent?: number
    spacingBefore?: number
    prefix?: string
  }

  /** 一段文字：行内公式留在文字流里，独立公式单独成段并居中 */
  const pushRich = (text: string, options: RichOptions = {}): void => {
    const tokens = splitMath(text)
    let runs: TextRun[] = []
    const base = { size: options.size, color: options.color }

    const flush = (): void => {
      if (runs.length === 0) return
      children.push(
        new Paragraph({
          children: runs,
          indent: options.indent ? { left: options.indent } : undefined,
          spacing: options.spacingBefore ? { before: options.spacingBefore } : undefined
        })
      )
      runs = []
    }

    if (options.prefix) runs.push(new TextRun({ text: options.prefix, bold: true, ...base }))

    for (const token of tokens) {
      if (token.type === 'text') {
        if (token.value) runs.push(new TextRun({ text: token.value, ...base }))
        continue
      }
      // 转不成 OMML 的公式退回 Unicode 近似，至少不会丢掉内容
      if (!token.omml) {
        runs.push(new TextRun({ text: latexToPlain(token.value), ...base }))
        continue
      }
      mathParts.push(token.omml)
      const placeholder = new TextRun({
        text: `@@TIKUBEN-MATH-${mathParts.length - 1}@@`,
        ...base
      })
      if (token.display) {
        flush()
        children.push(new Paragraph({ children: [placeholder], alignment: AlignmentType.CENTER }))
      } else {
        runs.push(placeholder)
      }
    }
    flush()
  }

  children.push(
    new Paragraph({ text: '题库导出', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `导出时间：${new Date().toLocaleString('zh-CN')}　共 ${questions.length} 道题`,
          color: '666666',
          size: 20
        })
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: '说明：公式已转成 Word 原生公式，可在 Word 里直接编辑。',
          color: '999999',
          size: 18
        })
      ]
    }),
    new Paragraph({ text: '' })
  )

  questions.forEach((question, index) => {
    const tags = collectTags(question, categoryMap, knowledgeMap)
    const heading = `${index + 1}. ${KIND_LABEL[question.kind]}${tags.length > 0 ? `　${tags.join(' · ')}` : ''}`
    children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }))
    pushRich(question.stem, { size: 22 })

    for (const option of question.options) {
      pushRich(`${option.label}. ${option.text}`, { size: 21, indent: 320 })
    }

    if (question.answer) {
      pushRich(question.answer, { size: 21, spacingBefore: 120, prefix: '答案：' })
    }

    if (question.analysis) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '解析：', bold: true, size: 21 })],
          spacing: { before: 120 }
        })
      )
      for (const line of question.analysis.split('\n')) {
        if (!line.trim()) continue
        pushRich(line, { size: 20, color: '333333', indent: 320 })
      }
    }

    children.push(new Paragraph({ text: '' }))
  })

  const doc = new Document({ sections: [{ children }] })
  return injectOmml(await Packer.toBuffer(doc), mathParts)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** PDF 用的 HTML：排版靠系统字体，公式走 Unicode 近似，不依赖 KaTeX 字体文件 */
function buildHtml(
  questions: Question[],
  categories: Category[],
  knowledge: KnowledgePoint[]
): string {
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]))
  const knowledgeMap = new Map(knowledge.map((item) => [item.id, item.name]))
  const blocks: string[] = []

  questions.forEach((question, index) => {
    const tags = collectTags(question, categoryMap, knowledgeMap)
    const tagHtml = tags.length > 0 ? `<span class="tag">${escapeHtml(tags.join(' · '))}</span>` : ''
    const options = question.options
      .map((option) => `<div class="option">${escapeHtml(option.label)}. ${escapeHtml(latexToPlain(option.text))}</div>`)
      .join('')
    const answer = question.answer
      ? `<div class="answer"><b>答案：</b>${escapeHtml(latexToPlain(question.answer))}</div>`
      : ''
    const analysis = question.analysis
      ? `<div class="analysis"><b>解析：</b><br>${escapeHtml(latexToPlain(question.analysis)).replace(/\n/g, '<br>')}</div>`
      : ''

    blocks.push(
      `<div class="question">` +
        `<div class="q-title">${index + 1}. ${KIND_LABEL[question.kind]}${tagHtml}</div>` +
        `<div class="stem">${escapeHtml(latexToPlain(question.stem))}</div>` +
        options +
        answer +
        analysis +
        `</div>`
    )
  })

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Microsoft YaHei", "Segoe UI", sans-serif; font-size: 13px; line-height: 1.75; color: #1b1f24; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 18px; }
  .question { margin-bottom: 16px; page-break-inside: avoid; }
  .q-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .tag { color: #2f5bd7; font-weight: normal; font-size: 11px; margin-left: 6px; }
  .stem { margin: 4px 0 6px; }
  .option { margin-left: 18px; }
  .answer { margin-top: 6px; }
  .analysis { color: #333; margin-top: 4px; }
  hr { border: none; border-top: 1px solid #e4e7ec; margin: 14px 0; }
</style>
</head>
<body>
<h1>题库导出</h1>
<div class="meta">导出时间：${escapeHtml(new Date().toLocaleString('zh-CN'))}　共 ${questions.length} 道题　公式为 Unicode 近似写法</div>
${blocks.join('<hr>')}
</body>
</html>`
}

/** PDF 导出：写临时 HTML，用隐藏窗口打印成 A4 */
export async function buildPdf(
  questions: Question[],
  categories: Category[],
  knowledge: KnowledgePoint[]
): Promise<Buffer> {
  const html = buildHtml(questions, categories, knowledge)
  const tempFile = join(app.getPath('temp'), `tikuben-export-${Date.now()}.html`)
  await fs.writeFile(tempFile, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadFile(tempFile)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 }
    })
  } finally {
    win.destroy()
    await fs.unlink(tempFile).catch(() => undefined)
  }
}
