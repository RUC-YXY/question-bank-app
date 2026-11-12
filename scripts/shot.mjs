/**
 * 截图脚本：插入演示数据，依次截主窗口、编辑抽屉、设置页、PDF 阅读窗口。
 * 用法：node scripts/shot.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9335
const OUT = 'D:\\错题本\\app\\docs\\screenshots'
const APPDATA = process.env.APPDATA
const DATA = join(APPDATA, '题库本', 'data')
const IMAGES = join(DATA, 'images')
const PDF = 'D:\\错题本\\app\\sample\\sample-questions.pdf'
const DOCX = 'D:\\错题本\\app\\sample\\sample-physics.docx'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

mkdirSync(OUT, { recursive: true })
mkdirSync(IMAGES, { recursive: true })

// 用 sample PDF 的首页当演示截图
const demoImage = join(IMAGES, 'demo-page.png')
const pdfPage = 'D:\\错题本\\app\\sample\\crop\\sample-questions-p1-clip.png'
if (existsSync(pdfPage)) copyFileSync(pdfPage, demoImage)

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
      /* ignore */
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
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
    return `${name}.png`
  }
  return { evaluate, shot, send, close: () => ws.close() }
}

const seed = `(async () => {
  const facets = await window.api.question.facets()
  let cat = facets.categories.find(c => c.name === '函数与导数')
  if (!cat) cat = await window.api.category.create('函数与导数')
  let kp1 = facets.knowledge.find(k => k.name === '导数应用')
  if (!kp1) kp1 = await window.api.kp.create('导数应用')
  let kp2 = facets.knowledge.find(k => k.name === '单调性')
  if (!kp2) kp2 = await window.api.kp.create('单调性')

  const now = new Date().toISOString()
  const base = {
    kind: 'wrong',
    questionType: 'choice',
    answer: '',
    analysis: '',
    categoryId: cat.id,
    knowledgeIds: [kp1.id, kp2.id],
    source: { capturedAt: now, docPath: 'D:\\\\错题本\\\\app\\\\sample\\\\sample-questions.pdf', page: 1 },
    imagePaths: ['images/demo-page.png'],
    rawModelOutput: '',
    confidence: 0.93,
    warnings: [],
    status: 'confirmed',
    createdAt: now,
    updatedAt: now
  }
  await window.api.question.save({
    ...base,
    stem: '已知函数 $f(x)=x^{3}-3x+1$，则 $f(x)$ 在区间 $[-2,\\\\,2]$ 上的最大值为（　）',
    options: [
      { label: 'A', text: '$3$' },
      { label: 'B', text: '$1$' },
      { label: 'C', text: '$-1$' },
      { label: 'D', text: '$5$' }
    ]
  })
  await window.api.question.save({
    ...base,
    questionType: 'fill',
    kind: 'new',
    confidence: 0.88,
    stem: '若等比数列 $\\\\{a_n\\\\}$ 中 $a_1=1$，$q=2$，则 $S_5=\\\\underline{\\\\qquad}$。',
    options: []
  })
  await window.api.question.save({
    ...base,
    questionType: 'solve',
    confidence: 0.76,
    warnings: ['原图下方有截断痕迹，请核对'],
    stem: '解不等式 $\\\\dfrac{x-1}{x+2}\\\\ge 0$，并写出解集。',
    options: []
  })
  return (await window.api.question.list({ offset: 0, limit: 100 })).total
})()`

const results = {}

try {
  const mainTarget = await waitFor((t) => t.url.includes('index.html'), 40000)
  const main = await connect(mainTarget)
  await sleep(1000)

  results.seeded = await main.evaluate(seed)
  // 可选用环境变量模拟窄窗口，检查工具栏会不会溢出
  const simWidth = Number(process.env.SHOT_WIDTH ?? 0)
  if (simWidth > 0) {
    await main.send('Emulation.setDeviceMetricsOverride', {
      width: simWidth,
      height: Number(process.env.SHOT_HEIGHT ?? 800),
      deviceScaleFactor: 1,
      mobile: false
    })
    await sleep(600)
  }
  const suffix = process.env.SHOT_SUFFIX ?? ''
  // 先把 sample PDF 记进最近文档，再点左列文件让阅读器在主窗口内加载
  await main.evaluate(`window.api.doc.touch(${JSON.stringify(PDF)})`)
  await sleep(1200)
  await main.evaluate(`(() => {
    const el = document.querySelector('.file-item')
    if (el) el.click()
    return !!el
  })()`)
  // 等卡片里的 lazy 图片解码、PDF 渲染完成再截
  await sleep(3500)
  results.main = await main.shot(`01-main-window${suffix}`)

  // 点开第一张卡片，打开编辑抽屉
  await main.evaluate(`(() => {
    const card = document.querySelector('.question-card')
    if (card) card.click()
    return !!card
  })()`)
  await sleep(700)
  results.drawer = await main.shot('02-edit-drawer')

  // 关掉抽屉
  await main.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.drawer button, .drawer .btn')]
      .find(b => /关闭|取消|×/.test(b.textContent ?? ''))
    if (btn) btn.click()
    return true
  })()`)
  await sleep(400)

  // 打开 PDF 阅读窗口
  await main.evaluate(`window.api.doc.openViewer(${JSON.stringify(PDF)})`)
  const viewerTarget = await waitFor((t) => t.url.includes('viewer.html'), 20000)
  await sleep(3000)
  const viewer = await connect(viewerTarget)
  results.viewer = await viewer.shot('03-pdf-viewer')
  viewer.close()

  // 打开 DOCX 阅读窗口
  await main.evaluate(`window.api.doc.openViewer(${JSON.stringify(DOCX)})`)
  await sleep(3500)
  const targets = await listTargets()
  const docxTarget = targets.find((t) => t.url.includes('viewer.html') && t.id !== viewerTarget.id)
  if (docxTarget) {
    const docx = await connect(docxTarget)
    results.docxViewer = await docx.shot('04-docx-viewer')
    docx.close()
  }

  // 打开设置窗口
  await main.evaluate(`window.api.app.openSettings()`)
  const settingsTarget = await waitFor((t) => t.url.includes('settings.html'), 20000)
  await sleep(1200)
  const settings = await connect(settingsTarget)
  results.settings = await settings.shot('05-settings')
  settings.close()

  main.close()
} catch (err) {
  results.error = err.message
} finally {
  killTree()
  await sleep(600)
  console.log(JSON.stringify(results, null, 2))
}
