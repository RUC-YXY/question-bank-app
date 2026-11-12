/**
 * 验证「截图时主窗口不隐藏」：打开 PDF 到阅读器，触发截图，把遮罩窗口截下来。
 * 遮罩底图就是抓到的屏幕，如果里面能看到主窗口与 PDF，说明窗口没被隐藏。
 * 用法：node scripts/shot-overlay.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9341
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
  return { send, evaluate, close: () => ws.close() }
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
  await sleep(3500)

  await main.evaluate(`window.api.capture.start()`)
  const overlayTarget = await waitFor((t) => t.url.includes('overlay.html'), 20000, '遮罩窗口')
  await sleep(1200)

  const overlay = await connect(overlayTarget)
  await overlay.send('Page.enable')
  const shot = await overlay.send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    writeFileSync('docs/screenshots/07-overlay-with-window.png', Buffer.from(shot.result.data, 'base64'))
    console.log('screenshot: docs/screenshots/07-overlay-with-window.png')
  }
  const meta = await overlay.evaluate(
    `({ shotW: document.querySelector('.overlay-shot')?.naturalWidth ?? 0, hint: document.querySelector('.overlay-hint')?.textContent ?? '' })`
  )
  console.log(JSON.stringify(meta))

  overlay.close()
  await main.evaluate(`window.api.capture.cancel()`).catch(() => undefined)
  main.close()
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
}
