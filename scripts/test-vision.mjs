/**
 * 直接调用识别接口，验证 key、模型名与多模态输入是否可用。
 * 用法：
 *   $env:DEEPSEEK_API_KEY='sk-...'; node scripts/test-vision.mjs [图片路径]
 */
import { readFileSync } from 'node:fs'

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error('缺少 DEEPSEEK_API_KEY 环境变量')
  process.exit(1)
}

const imagePath = process.argv[2] ?? 'sample/crop/sample-questions-p1-clip.png'
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'
const base64 = readFileSync(imagePath).toString('base64')

const SYSTEM = `你是一个把高中数学试卷截图转成结构化题目的助手。请严格按下面的规则输出 JSON。

规则：
1. 只处理高中数学。遇到非高中数学的内容（其他学科、大学数学、竞赛超纲题），不要识别，返回空数组并在 warnings 里写明原因。
2. 一张图里有几道完整题目就返回几条。题目被截断的整条不返回，并在顶层 warnings 里说明。
3. 公式一律用 LaTeX：行内用 $...$，独立公式用 $$...$$。分数、根号、上下标不许用纯文本近似。
4. 选项按原文标号（A/B/C/D 或 ①②③④），不要重新编号，不要把选项文字塞进题干。
5. 截图里同时出现题目和解答过程时，两部分都要识别：最终答案填进 answer，解答过程（推导步骤、板书、手写演算）填进 analysis。过程按原文转写，不要自己补步骤，也不要改写思路。
6. 一道题的解答过程如果出现在同一张图的别处（题目在上、过程在下，或者反过来），把它们归到同一道题里；不要因为过程离得远就当成另一道题。
7. 截图里没有答案和解析就留空字符串，禁止编造。
8. 题型三选一：choice（选择题）、fill（填空/判断）、solve（解答/计算）。
9. confidence 是你对这条识别结果的把握，取 0 到 1 之间的小数。
10. 只输出 JSON，不要输出任何解释文字，不要用 Markdown 代码围栏。

输出结构固定为：
{
  "questions": [
    {
      "stem": "题干（Markdown，公式用 $...$）",
      "options": [{ "label": "A", "text": "选项内容" }],
      "answer": "最终答案，没有就空串",
      "analysis": "解答过程，没有就空串",
      "questionType": "choice",
      "confidence": 0.9,
      "warnings": []
    }
  ],
  "warnings": []
}`

const body = {
  model,
  messages: [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: '识别这张截图中的题目。如果图里没有完整题目，返回空数组并在 warnings 里说明。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
      ]
    }
  ],
  response_format: { type: 'json_object' },
  max_tokens: 8000,
  temperature: 0.1
}

const started = Date.now()
let res
try {
  res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  })
} catch (err) {
  console.error('请求失败：', err.message)
  process.exit(1)
}
const elapsed = Date.now() - started
const text = await res.text()

console.log(`model=${model} status=${res.status} elapsed=${elapsed}ms bytes=${text.length}`)
if (!res.ok) {
  console.log(text.slice(0, 1200))
  process.exit(1)
}

const json = JSON.parse(text)
const choice = json.choices?.[0]
const content = choice?.message?.content ?? ''
console.log('finish_reason=', choice?.finish_reason, 'content_len=', content.trim().length)
console.log('usage=', JSON.stringify(json.usage))
if (choice?.message?.reasoning_content) {
  console.log('reasoning_len=', choice.message.reasoning_content.length)
}

try {
  const parsed = JSON.parse(content)
  console.log('questions=', parsed.questions?.length ?? 0)
  console.log(JSON.stringify(parsed, null, 2).slice(0, 3000))
} catch {
  console.log('--- 原始内容 ---')
  console.log(content.slice(0, 2000))
}
