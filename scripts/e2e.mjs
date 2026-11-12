/**
 * 端到端验证：启动应用 → 主窗口渲染 → 触发截图 → 遮罩回传选区 → 落盘 → mock 识别回填
 *              → 打开 PDF 阅读窗口。
 *
 * 用法：node scripts/e2e.mjs
 * 前置：已执行 pnpm build。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9334
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore'
})

const report = {}
let exitCode = 0

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
  if (!res.ok) throw new Error(`CDP ${res.status}`)
  return res.json()
}

async function waitFor(pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets()
      const hit = targets.find(pred)
      if (hit) return hit
    } catch {
      /* 还没就绪 */
    }
    await sleep(400)
  }
  throw new Error(`等待超时：${label}`)
}

async function evalOn(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 求值超时')), 20000)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== 1) return
      clearTimeout(timer)
      resolve(msg)
    }
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      })
    )
  })
  ws.close()
  if (message.result?.exceptionDetails) {
    throw new Error(message.result.exceptionDetails.text ?? '页面执行异常')
  }
  return message.result?.result?.value
}

const q = (n) => JSON.stringify(n)

try {
  const main = await waitFor((t) => t.url.includes('index.html'), 40000, '主窗口')
  await sleep(1200)

  report.mainWindow = await evalOn(
    main,
    `({
      title: document.title,
      hasShell: !!document.querySelector('.app-shell'),
      hasToolbar: !!document.querySelector('.toolbar'),
      hasSidebar: !!document.querySelector('.sidebar'),
      hasCardArea: !!document.querySelector('.card-scroll, .empty'),
      hasReaderPane: !!document.querySelector('.reader-pane'),
      hasSplitter: !!document.querySelector('.split-divider'),
      requireUndefined: typeof window.require === 'undefined',
      apiKeys: Object.keys(window.api ?? {}).sort().join(',')
    })`
  )

  const beforeIds = await evalOn(
    main,
    `window.api.question.list({ offset: 0, limit: 500 }).then(r => ({ total: r.total, ids: r.items.map(i => i.id) }))`
  )
  const before = beforeIds.total

  // 配置链路：只动 mock 开关，不碰真实 API Key（避免把已配好的 key 清掉）
  report.config = await evalOn(
    main,
    `(async () => {
      const beforeCfg = await window.api.config.get()
      const on = await window.api.config.set({ useMock: true })
      const readBack = await window.api.config.get()
      const off = await window.api.config.set({ useMock: false })
      return {
        hasApiKey: beforeCfg.hasApiKey,
        model: beforeCfg.apiModel,
        mockOn: on.useMock,
        mockReadBack: readBack.useMock,
        mockOff: off.useMock,
        dataDir: off.dataDir
      }
    })()`
  )

  // 分类与知识点：建 → 查 → 删
  report.facets = await evalOn(
    main,
    `(async () => {
      const cat = await window.api.category.create('E2E 测试分类')
      const kp = await window.api.kp.create('E2E 测试知识点')
      const list = await window.api.question.facets()
      await window.api.category.delete(cat.id)
      await window.api.kp.delete(kp.id)
      const after = await window.api.question.facets()
      return {
        catName: cat.name,
        kpName: kp.name,
        withBoth: list.categories.some(c => c.id === cat.id) && list.knowledge.some(k => k.id === kp.id),
        removed: !after.categories.some(c => c.id === cat.id) && !after.knowledge.some(k => k.id === kp.id)
      }
    })()`
  )

  // 触发一次截图：主窗口隐藏，遮罩窗口出现
  await evalOn(main, `window.api.capture.start()`)
  const overlay = await waitFor((t) => t.url.includes('overlay.html'), 15000, '遮罩窗口')
  await sleep(800)

  report.overlay = await evalOn(
    overlay,
    `({
      hasShot: !!document.querySelector('.overlay-shot'),
      hint: document.querySelector('.overlay-hint')?.textContent ?? '',
      viewport: [window.innerWidth, window.innerHeight]
    })`
  )

  // 主窗口不再 hide：遮罩全屏遮挡会让 visibilityState 变成 hidden，不能拿来判断。
  // 改看截图内容本身：如果抓到了应用界面，说明窗口是可见的。


  // 模拟用户框选：回传 CSS 坐标
  await evalOn(
    overlay,
    `window.api.capture.selected({ x: 120, y: 120, width: 560, height: 300, cssWidth: window.innerWidth, cssHeight: window.innerHeight })`
  )

  // 等主进程落盘 + mock 识别（800ms 延迟）
  await sleep(4000)

  const after = await evalOn(
    main,
    `window.api.question.list({ offset: 0, limit: 500 }).then(r => ({
      total: r.total,
      latest: r.items[0] ? {
        id: r.items[0].id,
        stem: r.items[0].stem.slice(0, 60),
        imagePaths: r.items[0].imagePaths,
        status: r.items[0].status,
        confidence: r.items[0].confidence,
        warnings: r.items[0].warnings
      } : null
    }))`
  )

  report.captureFlow = { before, after }

  report.cardImage = await evalOn(
    main,
    `(() => {
      const img = document.querySelector('.card-media img')
      if (!img) return { found: false }
      return { found: true, complete: img.complete, naturalWidth: img.naturalWidth, src: img.src.slice(0, 40) }
    })()`
  )

  const imagesDir = `${process.env.APPDATA}\\题库本\\data\\images`
  report.imageFileCount = existsSync(imagesDir) ? readdirSync(imagesDir).length : 0

  // 追加第二张截图到同一道题
  if (after.latest?.id) {
    const firstId = after.latest.id
    await evalOn(main, `window.api.capture.start(${q(firstId)})`)
    const overlay2 = await waitFor((t) => t.url.includes('overlay.html'), 15000, '遮罩窗口(追加)')
    await sleep(900)
    await evalOn(
      overlay2,
      `window.api.capture.selected({ x: 60, y: 60, width: 420, height: 210, cssWidth: window.innerWidth, cssHeight: window.innerHeight })`
    )
    await sleep(2500)
    report.appendCapture = await evalOn(
      main,
      `window.api.question.get(${q(firstId)}).then(q => ({
        imageCount: q ? q.imagePaths.length : -1,
        stem: q ? q.stem.slice(0, 30) : '',
        status: q ? q.status : ''
      }))`
    )
  }

  // 打开 PDF 阅读窗口
  await evalOn(main, `window.api.doc.openViewer(${q(PDF)})`)
  const viewer = await waitFor((t) => t.url.includes('viewer.html'), 20000, '阅读窗口')
  await sleep(3500)

  report.pdfViewer = await evalOn(
    viewer,
    `({
      hasCanvas: !!document.querySelector('canvas'),
      canvasSize: (() => { const c = document.querySelector('canvas'); return c ? [c.width, c.height] : null })(),
      toolbarText: (document.querySelector('.viewer-toolbar')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 120),
      bodyText: (document.body.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 160)
    })`
  )

  // 清理本次测试新建的题目，避免污染真实题库
  const created = await evalOn(
    main,
    `window.api.question.list({ offset: 0, limit: 500 })
      .then(r => r.items.map(i => i.id).filter(id => !${JSON.stringify(beforeIds.ids)}.includes(id)))`
  )
  for (const id of created) {
    await evalOn(main, `window.api.question.delete(${q(id)})`)
  }
  report.cleaned = created.length
} catch (err) {
  report.error = err.message
  exitCode = 1
} finally {
  killTree()
  await sleep(600)
  console.log(JSON.stringify(report, null, 2))
  process.exit(exitCode)
}
