/**
 * 验证解析展开与预览：题库视图展开解析、抽屉里解析的 Markdown/公式预览。
 * 用法：node scripts/verify-analysis.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9337
const OUT = 'D:\\错题本\\app\\docs\\screenshots'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

mkdirSync(OUT, { recursive: true })

spawn('taskkill', ['/IM', '题库本.exe', '/T', '/F'], { stdio: 'ignore' })
spawn('taskkill', ['/IM', 'electron.exe', '/T', '/F'], { stdio: 'ignore' })
await sleep(800)

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
  const shot = async (name) => {
    await send('Page.enable')
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const data = res.result?.data
    if (!data) throw new Error('截图失败')
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
    return `${name}.png`
  }
  return { evaluate, shot, send, close: () => ws.close() }
}

const ANALYSIS = [
  '1. 移项整理得 $\\dfrac{x-1}{x+2}\\ge 0$。',
  '2. 分子分母同号，等价于 $(x-1)(x+2)\\ge 0$ 且 $x\\ne -2$。',
  '3. 解得 $x\\le -2$ 或 $x\\ge 1$，去掉 $-2$ 后为 $x\\in(-\\infty,-2)\\cup[1,+\\infty)$。',
  '',
  '**易错点**：分母不能为零，$-2$ 必须排除。'
].join('\n')

const seed = {
  kind: 'wrong',
  questionType: 'solve',
  stem: '解不等式 $\\dfrac{x-1}{x+2}\\ge 0$，并写出解集。',
  options: [],
  answer: '$x\\in(-\\infty,-2)\\cup[1,+\\infty)$',
  analysis: ANALYSIS,
  knowledgeIds: [],
  source: { capturedAt: new Date().toISOString(), docPath: '', page: 1 },
  imagePaths: [],
  rawModelOutput: '',
  confidence: 0.92,
  warnings: [],
  status: 'confirmed',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

const results = {}

try {
  const target = await waitFor((t) => t.url.includes('index.html'), 40000)
  const main = await connect(target)
  await sleep(1200)

  // 先清掉上一次留下的测试题，避免重复
  results.cleaned = await main.evaluate(`(async () => {
    const list = await window.api.question.list({ offset: 0, limit: 500 })
    let removed = 0
    for (const q of list.items) {
      if (q.stem.includes('x-1}{x+2}')) {
        await window.api.question.delete(q.id)
        removed += 1
      }
    }
    return removed
  })()`)

  results.seeded = await main.evaluate(`(async () => {
    const facets = await window.api.question.facets()
    let cat = facets.categories.find((c) => c.name === '不等式')
    if (!cat) cat = await window.api.category.create('不等式')
    const base = ${JSON.stringify(seed)}
    await window.api.question.save({ ...base, categoryId: cat.id })
    return true
  })()`)
  await sleep(1200)

  // 切到题库视图
  await main.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.view-tabs button')].find((b) => b.textContent.trim() === '题库')
    if (tab) tab.click()
    return !!tab
  })()`)
  await sleep(1500)

  results.libraryCollapsed = await main.evaluate(`(() => ({
    expandButtons: document.querySelectorAll('.library-expand').length,
    analysisOpen: document.querySelectorAll('.library-analysis').length,
    hasSource: document.querySelector('.library-item')?.textContent?.includes('\\\\dfrac') ?? false
  }))()`)
  results.shotCollapsed = await main.shot('analysis-01-collapsed')

  // 展开解析
  await main.evaluate(`(() => {
    const btn = document.querySelector('.library-expand')
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(700)
  results.libraryExpanded = await main.evaluate(`(() => {
    const box = document.querySelector('.library-analysis')
    if (!box) return { open: false }
    return {
      open: true,
      hasKatex: box.querySelectorAll('.katex').length,
      listItems: box.querySelectorAll('ol > li').length,
      strong: box.querySelectorAll('strong').length,
      hasSource: box.textContent.includes('\\\\dfrac') || box.textContent.includes('\\\\infty'),
      text: box.textContent.trim().slice(0, 60)
    }
  })()`)
  results.shotExpanded = await main.shot('analysis-02-expanded')

  // 收起
  await main.evaluate(`(() => {
    const btn = document.querySelector('.library-expand.open')
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(500)
  results.libraryRecollapsed = await main.evaluate(
    `document.querySelectorAll('.library-analysis').length`
  )

  // 抽屉里的解析预览
  await main.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.library-edit')][0]
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2000)
  results.drawerPreview = await main.evaluate(`(() => {
    const field = [...document.querySelectorAll('.drawer-form .field')].find((f) =>
      f.textContent.includes('解析')
    )
    if (!field) return { ok: false, reason: '没有解析字段' }
    const box = field.querySelector('.preview-box')
    return {
      ok: !!box,
      hasKatex: box ? box.querySelectorAll('.katex').length : 0,
      listItems: box ? box.querySelectorAll('ol > li').length : 0,
      textareaValue: field.querySelector('textarea')?.value?.slice(0, 40) ?? ''
    }
  })()`)
  results.shotDrawer = await main.shot('analysis-03-drawer-preview')

  main.close()
} catch (err) {
  results.error = err.message
} finally {
  killTree()
  await sleep(600)
  console.log(JSON.stringify(results, null, 2))
}
