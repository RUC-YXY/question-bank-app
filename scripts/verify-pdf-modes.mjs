/**
 * 验证 PDF 阅读器的翻页模式：默认连续滚动、切到单页、再切回。
 * 用法：node scripts/verify-pdf-modes.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9342
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'
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
  return { send, evaluate, shot, close: () => ws.close() }
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

  await main.evaluate(`window.api.doc.touch(${JSON.stringify(PDF)})`)
  await sleep(1200)
  await main.evaluate(`(() => {
    const el = document.querySelector('.file-item')
    if (el) el.click()
    return !!el
  })()`)
  await sleep(4000)

  const report = {}
  report.scrollMode = await main.evaluate(`(() => {
    const slots = [...document.querySelectorAll('.pdf-page-slot')]
    return {
      slots: slots.length,
      activeMode: document.querySelector('.viewer-mode-switch .btn.active')?.getAttribute('aria-label') ?? '',
      canvases: slots.map(s => { const c = s.querySelector('canvas'); return c ? [c.width, c.height] : null }),
      slotSizes: slots.map(s => [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)]),
      pageLabel: document.querySelector('.viewer-page-input')?.value ?? ''
    }
  })()`)

  await main.shot('08-pdf-scroll-mode')

  // 滚到第二页，看页码是否跟着变
  await main.evaluate(`(() => {
    const area = document.querySelector('.viewer-canvas-area')
    const slot = document.querySelector('[data-page="2"]')
    if (area && slot) area.scrollTop = slot.offsetTop
    return true
  })()`)
  await sleep(1200)
  report.afterScroll = await main.evaluate(`({
    pageLabel: document.querySelector('.viewer-page-input')?.value ?? '',
    scrollTop: Math.round(document.querySelector('.viewer-canvas-area')?.scrollTop ?? 0)
  })`)

  // 切到单页
  await main.evaluate(`document.querySelector('[aria-label="单页翻页"]')?.click()`)
  await sleep(1500)
  report.singleMode = await main.evaluate(`({
    stage: !!document.querySelector('.viewer-canvas-stage'),
    slots: document.querySelectorAll('.pdf-page-slot').length,
    canvas: (() => { const c = document.querySelector('.viewer-canvas-stage canvas'); return c ? [c.width, c.height] : null })(),
    pageLabel: document.querySelector('.viewer-page-input')?.value ?? ''
  })`)
  await main.shot('09-pdf-single-mode')

  // 切回滚动
  await main.evaluate(`document.querySelector('[aria-label="连续滚动"]')?.click()`)
  await sleep(1500)
  report.backToScroll = await main.evaluate(`({
    slots: document.querySelectorAll('.pdf-page-slot').length,
    activeMode: document.querySelector('.viewer-mode-switch .btn.active')?.getAttribute('aria-label') ?? ''
  })`)

  console.log(JSON.stringify(report, null, 2))
  main.close()
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
}
