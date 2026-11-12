/**
 * 截两张图：阅读器双栏、抽屉里的选项预览。
 * 用法：node scripts/shot-split.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9345
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'
const IMAGE = 'D:\\错题本\\app\\sample\\crop\\sample-with-solution-p1.png'
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
  const shot = async (name) => {
    await send('Page.enable')
    const res = await send('Page.captureScreenshot', { format: 'png' })
    if (res.result?.data) {
      writeFileSync(`docs/screenshots/${name}.png`, Buffer.from(res.result.data, 'base64'))
    }
  }
  return { evaluate, shot, close: () => ws.close() }
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
  throw new Error('等待超时')
}

try {
  const target = await waitFor((t) => t.url.includes('index.html'), 40000)
  const main = await connect(target)
  await sleep(1500)

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
  await sleep(700)
  await main.evaluate(`(() => {
    const second = document.querySelectorAll('.reader-pane')[1]
    if (second) second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    return true
  })()`)
  await sleep(400)
  await main.evaluate(`(() => {
    const items = [...document.querySelectorAll('.file-item')]
    const img = items.find(i => i.title?.endsWith('.png'))
    if (img) img.click()
    return !!img
  })()`)
  await sleep(3000)
  await main.shot('12-split-view')
  console.log('12-split-view.png')

  // 插入一条带选项的题，打开抽屉看选项预览
  const id = await main.evaluate(`window.api.question.save({
    kind: 'wrong',
    questionType: 'choice',
    stem: '函数 $y=(3^{x}-3^{-x})\\\\cos x$ 在区间 $\\\\left[-\\\\dfrac{\\\\pi}{2},\\\\,\\\\dfrac{\\\\pi}{2}\\\\right]$ 上的图象大致为（　）',
    options: [
      { label: 'A', text: '左半区间图象在 $x$ 轴下方，右半区间图象在 $x$ 轴上方，关于原点中心对称' },
      { label: 'B', text: '图象关于 $y$ 轴对称，在区间内除原点外函数值为正，两侧各有一个正峰' },
      { label: 'C', text: '左半区间图象在 $x$ 轴上方，右半区间图象在 $x$ 轴下方，关于原点中心对称' },
      { label: 'D', text: '图象关于 $y$ 轴对称，在区间内除原点外函数值为负，两侧各有一个负谷' }
    ],
    answer: '',
    analysis: '',
    categoryId: null,
    knowledgeIds: [],
    source: { capturedAt: new Date().toISOString() },
    imagePaths: [],
    rawModelOutput: '',
    confidence: 0.9,
    warnings: []
  }).then(q => q.id)`)
  await sleep(1500)
  await main.evaluate(`(() => {
    const card = document.querySelector('.question-card')
    if (card) card.click()
    return !!card
  })()`)
  await sleep(1200)
  await main.shot('13-option-preview')
  console.log('13-option-preview.png')

  await main.evaluate(`window.api.question.delete(${JSON.stringify(id)})`)
  main.close()
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
}
