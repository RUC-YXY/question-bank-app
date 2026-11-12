/**
 * 验证：阅读器双栏、手动识别（多张图一起提交）。
 * 用法：node scripts/verify-split-recognize.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9344
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'
const IMAGE = 'D:\\错题本\\app\\sample\\crop\\sample-with-solution-p1.png'
const APPDATA = process.env.APPDATA
const IMAGES = join(APPDATA, '题库本', 'data', 'images')
mkdirSync(IMAGES, { recursive: true })
const testImage = join(IMAGES, 'verify-test.png')
copyFileSync(IMAGE, testImage)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

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
  return { evaluate, close: () => ws.close() }
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

try {
  const mainTarget = await waitFor((t) => t.url.includes('index.html'), 40000, '主窗口')
  const main = await connect(mainTarget)
  await sleep(1500)
  const report = {}

  // ── 1. 双栏 ──
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(PDF)})`)
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(IMAGE)})`)
  await sleep(1200)
  await main.evaluate(`(() => {
    const items = [...document.querySelectorAll('.file-item')]
    const pdf = items.find(i => i.title?.endsWith('.pdf') && i.title.includes('sample-questions'))
    if (pdf) pdf.click()
    return !!pdf
  })()`)
  await sleep(3000)

  await main.evaluate(`document.querySelector('[aria-label="并排查看两个文档"]')?.click()`)
  await sleep(800)
  // 点第二栏设置焦点
  await main.evaluate(`(() => {
    const panes = [...document.querySelectorAll('.reader-pane')]
    const second = panes[1]
    if (second) second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    return panes.length
  })()`)
  await sleep(500)
  await main.evaluate(`(() => {
    const items = [...document.querySelectorAll('.file-item')]
    const img = items.find(i => i.title?.endsWith('.png'))
    if (img) img.click()
    return !!img
  })()`)
  await sleep(2500)

  report.split = await main.evaluate(`(() => {
    const panes = [...document.querySelectorAll('.reader-pane')]
    return {
      paneCount: panes.length,
      firstHasCanvas: !!panes[0]?.querySelector('canvas'),
      secondHasImage: !!panes[1]?.querySelector('.image-viewer-area img'),
      focusedIndex: panes.findIndex(p => p.classList.contains('focused'))
    }
  })()`)

  // ── 2. 手动识别 ──
  const draftId = await main.evaluate(`(async () => {
    const q = await window.api.question.save({
      kind: 'wrong',
      questionType: 'solve',
      stem: '',
      options: [],
      answer: '',
      analysis: '',
      categoryId: null,
      knowledgeIds: [],
      source: { capturedAt: new Date().toISOString() },
      imagePaths: ['images/verify-test.png'],
      rawModelOutput: '',
      confidence: 0,
      warnings: []
    })
    await window.api.question.update(q.id, { status: 'draft' })
    return q.id
  })()`)

  const before = await main.evaluate(
    `window.api.question.get(${JSON.stringify(draftId)}).then(q => ({ stem: q.stem.length, status: q.status, images: q.imagePaths.length }))`
  )

  const started = Date.now()
  const recognized = await main.evaluate(
    `window.api.vision.recognizeQuestion(${JSON.stringify(draftId)})`
  )
  const elapsed = Date.now() - started

  const after = await main.evaluate(
    `window.api.question.get(${JSON.stringify(draftId)}).then(q => ({
      stem: q.stem.slice(0, 80),
      hasPrefix: /^\\s*[0-9]+\\s*[.．]|★|（20\\d\\d/.test(q.stem),
      answer: q.answer.slice(0, 60),
      analysisLength: q.analysis.length,
      confidence: q.confidence
    }))`
  )

  report.manualRecognize = { before, recognized, elapsed, after }

  // 清理
  await main.evaluate(`window.api.question.delete(${JSON.stringify(draftId)})`)
  main.close()
  console.log(JSON.stringify(report, null, 2))
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
  try {
    unlinkSync(testImage)
  } catch {
    /* ignore */
  }
}
