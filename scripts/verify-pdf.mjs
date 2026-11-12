/**
 * 验证 PDF 阅读器换成官方 PDFViewer 组件后的表现。
 * 检查：页面渲染、文本层、双栏、适应宽度、单页模式、搜索高亮。
 * 用法：node scripts/verify-pdf.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9336
const OUT = 'D:\\错题本\\app\\docs\\screenshots'
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

mkdirSync(OUT, { recursive: true })

// 残留进程会占住单实例锁，先清掉
spawn('taskkill', ['/IM', '题库本.exe', '/T', '/F'], { stdio: 'ignore' })
spawn('taskkill', ['/IM', 'electron.exe', '/T', '/F'], { stdio: 'ignore' })
await sleep(800)

const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore'
})

function killTree() {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return res.json()
}

async function waitFor(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets()
      const hit = targets.find(pred)
      if (hit) return hit
    } catch {
      /* 还没起来 */
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

/** 采集每个 PDF 阅读区的渲染状态 */
const PROBE = `(() => {
  const areas = [...document.querySelectorAll('.pdf-viewer-area')]
  return areas.map((area) => {
    const pages = [...area.querySelectorAll('.pdfViewer .page')]
    const first = pages[0]
    const canvas = area.querySelector('.pdfViewer .page canvas')
    return {
      containerWidth: Math.round(area.clientWidth),
      containerHeight: Math.round(area.clientHeight),
      pages: pages.length,
      textSpans: area.querySelectorAll('.textLayer span').length,
      pageWidth: first ? Math.round(first.getBoundingClientRect().width) : 0,
      pageHeight: first ? Math.round(first.getBoundingClientRect().height) : 0,
      canvasPixels: canvas ? canvas.width + 'x' + canvas.height : '',
      scaleFactor: area.querySelector('.pdfViewer')?.style.getPropertyValue('--scale-factor') ?? '',
      overflowX: area.scrollWidth - area.clientWidth,
      singlePage: !!area.querySelector('.pdfViewer.singlePageView')
    }
  })
})()`

const results = {}

try {
  const mainTarget = await waitFor((t) => t.url.includes('index.html'), 40000)
  const main = await connect(mainTarget)
  await sleep(1200)

  // 固定成连续滚动模式，避免受上一次运行留下的偏好影响
  await main.evaluate(`localStorage.setItem('tikuben:pdf-view-mode', 'scroll')`)
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(PDF)})`)
  await sleep(800)
  await main.evaluate(`(() => {
    const el = document.querySelector('.file-item')
    if (el) el.click()
    return !!el
  })()`)
  await sleep(3500)

  results.scrollMode = await main.evaluate(PROBE)
  results.shotScroll = await main.shot('pdf-01-scroll')

  // 文本层能不能真的选中文字
  results.selection = await main.evaluate(`(() => {
    const span = document.querySelector('.textLayer span')
    if (!span) return { ok: false, reason: '没有文本层' }
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    const text = sel.toString()
    sel.removeAllRanges()
    return { ok: text.length > 0, text: text.slice(0, 40) }
  })()`)

  // 搜索：看命中数与页面上的高亮节点
  results.search = await main.evaluate(`(async () => {
    const input = document.querySelector('.search-box input')
    if (!input) return { ok: false, reason: '没有搜索框' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '函数')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    const btn = [...document.querySelectorAll('.viewer-toolbar .btn')].find((b) => b.textContent.includes('搜索'))
    if (btn) btn.click()
    await new Promise((r) => setTimeout(r, 2000))
    const statusEl = document.querySelector('.viewer-search-status')
    const spanEl = statusEl?.querySelector('span')
    const statusRect = statusEl?.getBoundingClientRect()
    const spanRect = spanEl?.getBoundingClientRect()
    const hostRect = statusEl?.parentElement?.getBoundingClientRect()
    return {
      ok: true,
      status: statusEl?.textContent?.trim() ?? '',
      highlights: document.querySelectorAll('.textLayer .highlight').length,
      box: statusRect ? { x: Math.round(statusRect.x), w: Math.round(statusRect.width) } : null,
      spanBox: spanRect
        ? { x: Math.round(spanRect.x), w: Math.round(spanRect.width), scrollW: spanEl.scrollWidth }
        : null,
      hostBox: hostRect ? { x: Math.round(hostRect.x), w: Math.round(hostRect.width) } : null,
      statusOverflow: statusEl ? statusEl.scrollWidth - statusEl.clientWidth : 0,
      layout: (() => {
        const body = document.querySelector('.app-body')
        const sidebar = document.querySelector('.doc-sidebar')
        const bar = document.querySelector('.reader-bar')
        const rect = (el) =>
          el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width) } : null
        return {
          bodyDisplay: body ? getComputedStyle(body).display : '',
          bodyCols: body ? getComputedStyle(body).gridTemplateColumns : '',
          sidebar: rect(sidebar),
          bar: rect(bar)
        }
      })()
    }
  })()`)
  results.shotSearch = await main.shot('pdf-02-search')

  // 开双栏：第二栏应该也有渲染
  await main.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.reader-bar .btn')].find((b) => (b.title ?? '').includes('并排'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2500)
  results.split = await main.evaluate(PROBE)
  results.shotSplit = await main.shot('pdf-03-split')

  // 双栏下点「适应宽度」，看是否真的铺满且没有横向溢出
  await main.evaluate(`(() => {
    const areas = [...document.querySelectorAll('.pdf-viewer-area')]
    const btns = [...areas[0].closest('.reader-pane').querySelectorAll('.viewer-toolbar .btn')]
    const btn = btns.find((b) => (b.title ?? '').includes('适应宽度'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(1500)
  results.fitWidth = await main.evaluate(PROBE)
  results.shotFit = await main.shot('pdf-04-fit-split')

  // 单页模式
  await main.evaluate(`(() => {
    const btns = [...document.querySelectorAll('.viewer-mode-switch .btn')]
    const btn = btns.find((b) => (b.title ?? '').includes('单页'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await sleep(2000)
  results.singlePage = await main.evaluate(PROBE)
  results.shotSingle = await main.shot('pdf-05-single')

  // 上一轮的三项：侧栏折叠、双栏分隔条
  results.sidebarToggle = await main.evaluate(`(async () => {
    const btn = document.querySelector('button[aria-label*="文件栏"]')
    if (!btn) return { ok: false, reason: '没找到侧栏按钮' }
    btn.click()
    await new Promise((r) => setTimeout(r, 500))
    const hidden = !document.querySelector('.doc-sidebar')
    const cols = getComputedStyle(document.querySelector('.app-body')).gridTemplateColumns
    const width = Math.round(document.querySelector('.pdf-viewer-area').clientWidth)
    btn.click()
    await new Promise((r) => setTimeout(r, 500))
    return {
      ok: true,
      hidden,
      colsWhileHidden: cols,
      readerWidthWhileHidden: width,
      restored: !!document.querySelector('.doc-sidebar')
    }
  })()`)
  results.shotSidebarHidden = await main.shot('pdf-06-sidebar-toggle')

  results.paneDivider = await main.evaluate(`(() => {
    const d = document.querySelector('.pane-divider')
    return d
      ? { exists: true, width: Math.round(d.getBoundingClientRect().width), title: d.title }
      : { exists: false }
  })()`)

  main.close()
} catch (err) {
  results.error = err.message
} finally {
  killTree()
  await sleep(600)
  console.log(JSON.stringify(results, null, 2))
}
