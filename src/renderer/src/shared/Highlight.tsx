import { useMemo } from 'react'

/** 把 Markdown 压成单行纯文本，用于卡片摘要与检索命中高亮 */
export function stripMarkdown(source: string): string {
  return source
    .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Part {
  text: string
  hit: boolean
}

function splitByKeyword(text: string, keyword: string): Part[] {
  const kw = keyword.trim()
  if (!kw) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const needle = kw.toLowerCase()
  const parts: Part[] = []
  let cursor = 0
  for (;;) {
    const idx = lower.indexOf(needle, cursor)
    if (idx < 0) break
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + kw.length), hit: true })
    cursor = idx + kw.length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts.length > 0 ? parts : [{ text, hit: false }]
}

export function Highlighted({ text, keyword }: { text: string; keyword: string }) {
  const parts = useMemo(() => splitByKeyword(text, keyword), [text, keyword])
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
      )}
    </>
  )
}
