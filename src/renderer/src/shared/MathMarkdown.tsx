import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const md = new MarkdownIt({
  html: false, // 防注入：题干里的 HTML 一律当文本
  linkify: true,
  breaks: true
})

const MATH_BLOCK = /\$\$([\s\S]*?)\$\$/g
const MATH_INLINE = /\$([^$\n]+?)\$/g
const PLACEHOLDER = /%%%MATH(\d+)%%%/g

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMath(tex: string, displayMode: boolean): string {
  const trimmed = tex.trim()
  if (!trimmed) return ''
  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html'
    })
  } catch {
    return escapeHtml(tex)
  }
}

/** 先把公式抽成占位符，交给 KaTeX 渲染，再让 markdown-it 处理其余文本。 */
function renderWithMath(source: string, inline: boolean): string {
  const stash: string[] = []
  const keep = (html: string): string => {
    stash.push(html)
    return `%%%MATH${stash.length - 1}%%%`
  }

  let text = source.replace(MATH_BLOCK, (_m, tex: string) => keep(renderMath(tex, true)))
  text = text.replace(MATH_INLINE, (_m, tex: string) => keep(renderMath(tex, false)))

  const html = inline ? md.renderInline(text) : md.render(text)
  return html.replace(PLACEHOLDER, (_m, index: string) => stash[Number(index)] ?? '')
}

export function MathMarkdown({
  source,
  className
}: {
  source: string
  className?: string
}) {
  const html = useMemo(() => renderWithMath(source, false), [source])
  return <div className={`math-md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

/** 行内渲染，不包 <p>，用于选项文字 */
export function MathText({ source }: { source: string }) {
  const html = useMemo(() => renderWithMath(source, true), [source])
  return <span className="math-md math-md-inline" dangerouslySetInnerHTML={{ __html: html }} />
}
