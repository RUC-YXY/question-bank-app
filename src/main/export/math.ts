import katex from 'katex'
import { mml2omml } from 'mathml2omml'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/**
 * 把 LaTeX 转成 OMML（Word 原生公式）。
 * 走 KaTeX 的 MathML 输出再交给 mml2omml，转换失败返回 null，调用方退回纯文本。
 */
export function latexToOmml(tex: string, display: boolean): string | null {
  try {
    const html = katex.renderToString(tex, {
      output: 'mathml',
      displayMode: display,
      throwOnError: true,
      strict: 'ignore'
    })
    const start = html.indexOf('<math')
    const end = html.lastIndexOf('</math>')
    if (start < 0 || end < 0) return null
    // KaTeX 外面套了 span 和 semantics/annotation，只取纯 MathML 主体
    const core = html
      .slice(start, end + '</math>'.length)
      .replace(/<semantics>/g, '')
      .replace(/<\/semantics>/g, '')
      .replace(/<annotation[\s\S]*?<\/annotation>/g, '')
    return mml2omml(core)
  } catch {
    return null
  }
}

export type MathToken =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean; omml: string | null }

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g

/** 把一段文本切成普通文字与公式片段，公式顺带转好 OMML */
export function splitMath(source: string): MathToken[] {
  const tokens: MathToken[] = []
  let last = 0
  MATH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MATH_PATTERN.exec(source)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: source.slice(last, match.index) })
    }
    const display = match[1] !== undefined
    const tex = (display ? match[1] : match[2]) ?? ''
    tokens.push({ type: 'math', value: tex, display, omml: latexToOmml(tex, display) })
    last = match.index + match[0].length
  }
  if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) })
  return tokens
}

const PLACEHOLDER = /@@TIKUBEN-MATH-(\d+)@@/g

/**
 * 把占位符所在的 run 换成 OMML。
 * docx 不开放插入原始数学 XML 的接口，只能在生成好的文档里替换：
 * `<w:r>...@@TIKUBEN-MATH-n@@...</w:r>` → `<m:oMath>...</m:oMath>`。
 */
export function injectOmml(buffer: Buffer, parts: string[]): Buffer {
  if (parts.length === 0) return buffer
  const files = unzipSync(new Uint8Array(buffer))
  const entry = files['word/document.xml']
  if (!entry) return buffer
  const xml = strFromU8(entry)

  let out = ''
  let last = 0
  let changed = false
  PLACEHOLDER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER.exec(xml)) !== null) {
    const start = Math.max(
      xml.lastIndexOf('<w:r>', match.index),
      xml.lastIndexOf('<w:r ', match.index)
    )
    const end = xml.indexOf('</w:r>', match.index)
    if (start < last || end < 0) continue
    const omml = parts[Number(match[1])]
    if (!omml) continue
    out += xml.slice(last, start) + omml
    last = end + '</w:r>'.length
    changed = true
  }
  if (!changed) return buffer
  out += xml.slice(last)

  files['word/document.xml'] = strToU8(out)
  return Buffer.from(zipSync(files, { level: 6 }))
}
