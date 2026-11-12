/**
 * 验证 Word 导出的公式是不是 Word 原生公式（OMML），而不是 Unicode 近似。
 * 用法：node scripts/verify-docx-math.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { strFromU8, unzipSync } from 'fflate'

const PORT = 9338
const OUT = 'D:\\错题本\\app\\build\\export-test'

const env = { ...process.env, TIKUBEN_EXPORT_DIR: OUT }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

spawn('taskkill', ['/IM', '题库本.exe', '/T', '/F'], { stdio: 'ignore' })
spawn('taskkill', ['/IM', 'electron.exe', '/T', '/F'], { stdio: 'ignore' })
await sleep(800)
rmSync(OUT, { recursive: true, force: true })

const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })

function killTree() {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
}

async function waitFor(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const hit = list.find(pred)
      if (hit) return hit
    } catch {
      /* 等启动 */
    }
    await sleep(400)
  }
  throw new Error('等待页面超时')
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const handler = pending.get(msg.id)
    if (handler) {
      pending.delete(msg.id)
      handler(msg)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      seq += 1
      const id = seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.text ?? '页面异常')
    }
    return res.result?.result?.value
  }
  return { evaluate, close: () => ws.close() }
}

const QUESTIONS = [
  {
    stem: '解不等式 $\\dfrac{x-1}{x+2}\\ge 0$，并写出解集。',
    options: [],
    answer: '$x\\in(-\\infty,-2)\\cup[1,+\\infty)$',
    analysis:
      '1. 移项整理得 $\\dfrac{x-1}{x+2}\\ge 0$。\n2. 分子分母同号，等价于 $(x-1)(x+2)\\ge 0$ 且 $x\\ne -2$。\n3. 解得 $x\\le -2$ 或 $x\\ge 1$，去掉 $-2$ 后为 $x\\in(-\\infty,-2)\\cup[1,+\\infty)$。'
  },
  {
    stem: '已知 $f(x)=\\begin{cases}-0.1x^{2}+20x-300,&0<x\\le 120\\\\-x-\\dfrac{25600}{x}+1050,&x>120\\end{cases}$，求 $f(x)$ 的最大值。',
    options: [
      { label: 'A', text: '$700$' },
      { label: 'B', text: '$730$' }
    ],
    answer: '$730$',
    analysis: '当 $0<x\\le 120$ 时，$f(x)$ 在 $x=100$ 处取得最大值 $700$；当 $x>120$ 时最大值为 $730$。'
  },
  {
    stem: '等比数列 $\\{a_n\\}$ 中 $a_1=1$，$q=2$，求 $\\sum_{i=1}^{5} a_i$。',
    options: [],
    answer: '$S_5=31$',
    analysis: '由求和公式 $S_n=\\dfrac{a_1(1-q^{n})}{1-q}$ 得 $S_5=\\dfrac{1\\times(1-2^{5})}{1-2}=31$。'
  }
]

const results = {}

try {
  const target = await waitFor((t) => t.url.includes('index.html'), 40000)
  const main = await connect(target)
  await sleep(1200)

  const ids = await main.evaluate(`(async () => {
    const list = await window.api.question.list({ offset: 0, limit: 500 })
    for (const q of list.items) {
      if (q.stem.includes('\\\\dfrac{x-1}') || q.stem.includes('求 $f(x)$ 的最大值') || q.stem.includes('等比数列')) {
        await window.api.question.delete(q.id)
      }
    }
    const now = new Date().toISOString()
    const seeds = ${JSON.stringify(QUESTIONS)}
    const saved = []
    for (const seed of seeds) {
      const question = await window.api.question.save({
        ...seed,
        kind: 'wrong',
        questionType: seed.options.length > 0 ? 'choice' : 'solve',
        categoryId: null,
        knowledgeIds: [],
        source: { capturedAt: now, docPath: '', page: 1 },
        imagePaths: [],
        rawModelOutput: '',
        confidence: 0.9,
        warnings: [],
        status: 'confirmed',
        createdAt: now,
        updatedAt: now
      })
      saved.push(question.id)
    }
    return saved
  })()`)

  results.seeded = ids.length

  const file = await main.evaluate(
    `window.api.library.exportQuestions(${JSON.stringify(ids)}, 'docx')`
  )
  results.file = file

  await sleep(500)
  if (!existsSync(file)) throw new Error('导出文件不存在')

  const files = unzipSync(new Uint8Array(readFileSync(file)))
  const documentXml = strFromU8(files['word/document.xml'])

  const count = (pattern) => (documentXml.match(pattern) ?? []).length

  results.check = {
    size: readFileSync(file).length,
    oMath: count(/<m:oMath/g),
    fraction: count(/<m:f>/g),
    radical: count(/<m:rad>/g),
    matrix: count(/<m:m>/g),
    nary: count(/<m:nary>/g),
    superscript: count(/<m:sSup>/g),
    subscript: count(/<m:sSub>/g),
    leftoverPlaceholder: count(/@@TIKUBEN-MATH-\d+@@/g),
    leftoverLatex: count(/\\\\[a-zA-Z]+/g)
  }

  // 抽一段正文看看结构
  const sample = documentXml.indexOf('<m:oMath')
  results.sample = sample >= 0 ? documentXml.slice(sample, sample + 320) : ''

  // OMML 必须是段落的直接子元素，不能留在 w:r 里，否则 Word 打不开公式
  results.structure = {
    entries: Object.keys(files).length,
    hasDocument: Object.keys(files).includes('word/document.xml'),
    hasContentTypes: Object.keys(files).includes('[Content_Types].xml'),
    mathInsideRun: count(/<w:r[^>]*>(?:(?!<\/w:r>)[\s\S])*?<m:oMath/g),
    mathInsideParagraph: count(/<w:p[ >][\s\S]{0,80}?<m:oMath/g)
  }

  main.close()
} catch (err) {
  results.error = err.message
} finally {
  killTree()
  await sleep(600)
  console.log(JSON.stringify(results, null, 2))
}
