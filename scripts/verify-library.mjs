/**
 * 验证题库窗口与三种导出格式。
 * 用法：node scripts/verify-library.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9347
const APPDATA = process.env.APPDATA
const IMAGES = join(APPDATA, '题库本', 'data', 'images')
const OUT_DIR = 'D:\\错题本\\app\\build\\export-test'
mkdirSync(IMAGES, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })
const demoImage = join(IMAGES, 'lib-test.png')
copyFileSync('D:\\错题本\\app\\sample\\crop\\sample-questions-p1-clip.png', demoImage)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.TIKUBEN_EXPORT_DIR = OUT_DIR

const child = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore'
})

const kill = () => {
  if (child.pid === undefined) return
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    const h = pending.get(m.id)
    if (h) {
      pending.delete(m.id)
      h(m)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      seq += 1
      pending.set(seq, res)
      ws.send(JSON.stringify({ id: seq, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text ?? '页面异常')
    return res.result?.result?.value
  }
  const shot = async (name) => {
    await send('Page.enable')
    const res = await send('Page.captureScreenshot', { format: 'png' })
    if (res.result?.data) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`docs/screenshots/${name}.png`, Buffer.from(res.result.data, 'base64'))
    }
  }
  return { evaluate, shot, close: () => ws.close() }
}

async function waitFor(pred, timeoutMs, label) {
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
  throw new Error(`等待超时：${label}`)
}

const seed = `(async () => {
  const now = new Date().toISOString()
  const base = {
    kind: 'wrong',
    questionType: 'choice',
    answer: '',
    analysis: '',
    categoryId: null,
    knowledgeIds: [],
    source: { capturedAt: now },
    imagePaths: [],
    rawModelOutput: '',
    confidence: 0.9,
    warnings: []
  }
  const q1 = await window.api.question.save({
    ...base,
    stem: '已知函数 $f(x)=x^{3}-3x+1$，则 $f(x)$ 在区间 $[-2,\\\\,2]$ 上的最大值为（　）',
    options: [
      { label: 'A', text: '$3$' },
      { label: 'B', text: '$1$' },
      { label: 'C', text: '$-1$' },
      { label: 'D', text: '$5$' }
    ]
  })
  const q2 = await window.api.question.save({
    ...base,
    questionType: 'solve',
    stem: '解不等式 $\\\\dfrac{x-1}{x+2}\\\\ge 0$，并写出解集。',
    options: [],
    answer: '$(-\\\\infty,\\\\,-2)\\\\cup[1,\\\\,+\\\\infty)$',
    analysis: '移项通分后按符号讨论，分界点为 $-2$ 与 $1$。'
  })
  return [q1.id, q2.id]
})()`

try {
  const mainTarget = await waitFor((t) => t.url.includes('index.html'), 40000, '主窗口')
  const main = await connect(mainTarget)
  await sleep(1500)
  const report = {}

  const ids = await main.evaluate(seed)
  await sleep(800)

  // 切到题库视图
  await main.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.view-tabs button')].find(b => b.textContent.trim() === '题库')
    if (tab) tab.click()
    return !!tab
  })()`)
  await sleep(1800)

  report.libraryUi = await main.evaluate(`({
    items: document.querySelectorAll('.library-item').length,
    hasExportButtons: [...document.querySelectorAll('.library-toolbar button')].map(b => b.textContent.trim()),
    hasEditButtons: document.querySelectorAll('.library-edit').length,
    showsLatex: document.body.innerText.includes('\\\\dfrac') || document.body.innerText.includes('$'),
    hasImage: !!document.querySelector('.library-item img')
  })`)

  await main.shot('14-library-window')

  // 导出三种格式（走环境变量直写，跳过对话框）
  const exports = {}
  for (const format of ['md', 'docx', 'pdf']) {
    const saved = await main.evaluate(
      `window.api.library.exportQuestions(${JSON.stringify(ids)}, '${format}')`
    )
    exports[format] = {
      saved,
      exists: saved ? existsSync(saved) : false,
      bytes: saved && existsSync(saved) ? statSync(saved).size : 0
    }
  }
  report.exports = exports

  // 修改按钮：应切回录入视图并打开抽屉
  await main.evaluate(`document.querySelector('.library-edit')?.click()`)
  await sleep(2000)
  report.editFlow = await main.evaluate(`({
    drawerOpen: !!document.querySelector('.drawer'),
    title: document.querySelector('.drawer-title')?.textContent ?? ''
  })`)

  main.close()
  console.log(JSON.stringify(report, null, 2))
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
  try {
    unlinkSync(demoImage)
  } catch {
    /* ignore */
  }
}
