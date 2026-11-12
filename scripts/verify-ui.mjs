/**
 * 验证：图片在阅读器里打开、PDF 滚动模式、切换单页后是否重新渲染。
 * 用法：node scripts/verify-ui.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9343
const IMAGE = 'D:\\错题本\\app\\sample\\crop\\sample-with-solution-p1.png'
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

try {
  const mainTarget = await waitFor((t) => t.url.includes('index.html'), 40000, '主窗口')
  const main = await connect(mainTarget)
  await sleep(1500)
  const report = {}

  // 1. 图片进阅读器
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(IMAGE)})`)
  await sleep(1200)
  await main.evaluate(`(() => {
    const el = document.querySelector('.file-item')
    if (el) el.click()
    return !!el
  })()`)
  await sleep(2500)
  report.imageViewer = await main.evaluate(`(() => {
    const img = document.querySelector('.image-viewer-area img')
    const bar = document.querySelector('.reader-bar .reader-name')?.textContent ?? ''
    return {
      hasImg: !!img,
      naturalWidth: img ? img.naturalWidth : 0,
      cssWidth: img ? Math.round(img.getBoundingClientRect().width) : 0,
      readerTitle: bar.trim(),
      zoomLabel: document.querySelector('.reader-viewer .viewer-zoom-label')?.textContent ?? ''
    }
  })()`)
  await main.shot('10-image-in-reader')

  // 2. PDF 滚动模式
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(PDF)})`)
  await sleep(1200)
  await main.evaluate(`(() => {
    const el = document.querySelector('.file-item')
    if (el) el.click()
    return !!el
  })()`)
  await sleep(4000)
  report.pdfScroll = await main.evaluate(`(() => {
    const slots = [...document.querySelectorAll('.pdf-page-slot')]
    return {
      slots: slots.length,
      activeMode: document.querySelector('.viewer-mode-switch .btn.active')?.getAttribute('aria-label') ?? '',
      firstCanvas: (() => { const c = slots[0]?.querySelector('canvas'); return c ? [c.width, c.height] : null })()
    }
  })()`)
  await main.shot('11-pdf-scroll')

  // 3. 切单页后应重新渲染（canvas 不再是 300×150）
  await main.evaluate(`document.querySelector('[aria-label="单页翻页"]')?.click()`)
  await sleep(2000)
  report.singleAfterSwitch = await main.evaluate(`(() => {
    const c = document.querySelector('.viewer-canvas-stage canvas')
    return {
      stage: !!document.querySelector('.viewer-canvas-stage'),
      canvas: c ? [c.width, c.height] : null,
      pageLabel: document.querySelector('.viewer-page-input')?.value ?? ''
    }
  })()`)

  console.log(JSON.stringify(report, null, 2))
  main.close()
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
}
