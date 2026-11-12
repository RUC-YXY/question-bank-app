/**
 * 检查打包后的免安装版：启动、CDP 检查主窗口结构、截图。
 * 用法：node scripts/verify-packaged.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9340
const EXPORT_DIR = 'D:\\错题本\\app\\build\\export-test'
const env = { ...process.env, TIKUBEN_EXPORT_DIR: EXPORT_DIR }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('release/win-unpacked/题库本.exe', [`--remote-debugging-port=${PORT}`], {
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
  return { send, close: () => ws.close() }
}

try {
  let target = null
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      target = list.find((t) => t.url.includes('index.html'))
      if (target) break
    } catch {
      /* 等启动 */
    }
    await sleep(500)
  }
  if (!target) throw new Error('主窗口没起来')
  await sleep(2000)

  const c = await connect(target)
  const expr = `({
    title: document.title,
    readerPane: !!document.querySelector('.reader-pane'),
    splitter: !!document.querySelector('.split-divider'),
    cardGrid: !!document.querySelector('.card-grid'),
    captureBtn: [...document.querySelectorAll('.toolbar button')].some(b => b.textContent.includes('录入新题')),
    requireUndefined: typeof window.require === 'undefined',
    apiCount: Object.keys(window.api ?? {}).length,
    hasApiKey: await window.api.config.get().then(c => c.hasApiKey)
  })`
  const res = await c.send('Runtime.evaluate', {
    expression: `(async () => ${expr})()`,
    returnByValue: true,
    awaitPromise: true
  })
  console.log(JSON.stringify(res.result?.result?.value, null, 2))

  // 打包后官方 viewer 是独立 chunk，走 file:// 动态加载，必须实测
  const pdfRes = await c.send('Runtime.evaluate', {
    expression: `(async () => {
      await window.api.doc.touch(${JSON.stringify('D:\\\\错题本\\\\app\\\\sample\\\\sample-questions.pdf')})
      await new Promise((r) => setTimeout(r, 900))
      const item = document.querySelector('.file-item')
      if (item) item.click()
      await new Promise((r) => setTimeout(r, 4000))
      const area = document.querySelector('.pdf-viewer-area')
      return {
        area: !!area,
        pages: document.querySelectorAll('.pdfViewer .page').length,
        textSpans: document.querySelectorAll('.textLayer span').length,
        canvas: !!document.querySelector('.pdfViewer .page canvas'),
        overflowX: area ? area.scrollWidth - area.clientWidth : -1,
        loading: !!document.querySelector('.viewer-state-overlay')
      }
    })()`,
    returnByValue: true,
    awaitPromise: true
  })
  console.log('PDF:', JSON.stringify(pdfRes.result?.result?.value, null, 2))

  // 打包后 katex / mathml2omml / fflate 都打进了主进程 bundle，实测一次 Word 导出
  const docxRes = await c.send('Runtime.evaluate', {
    expression: `(async () => {
      const now = new Date().toISOString()
      const q = await window.api.question.save({
        kind: 'wrong',
        questionType: 'solve',
        stem: '解不等式 $\\\\dfrac{x-1}{x+2}\\\\ge 0$，并写出解集。',
        options: [],
        answer: '$x\\\\in(-\\\\infty,-2)\\\\cup[1,+\\\\infty)$',
        analysis: '1. 移项得 $\\\\dfrac{x-1}{x+2}\\\\ge 0$。\\n2. 解得 $x\\\\le -2$ 或 $x\\\\ge 1$。',
        categoryId: null,
        knowledgeIds: [],
        source: { capturedAt: now, docPath: '', page: 1 },
        imagePaths: [],
        rawModelOutput: '',
        confidence: 0.9,
        warnings: [],
        status: 'confirmed',
        createdAt: now,
        updatedAt: now
      })
      const file = await window.api.library.exportQuestions([q.id], 'docx')
      await window.api.question.delete(q.id)
      return file
    })()`,
    returnByValue: true,
    awaitPromise: true
  })
  const docxPath = docxRes.result?.result?.value
  console.log(
    'DOCX:',
    JSON.stringify(
      {
        path: docxPath ?? null,
        exists: typeof docxPath === 'string' && existsSync(docxPath),
        size: typeof docxPath === 'string' && existsSync(docxPath) ? statSync(docxPath).size : 0,
        error: docxRes.result?.exceptionDetails?.text ?? null
      },
      null,
      2
    )
  )

  await c.send('Page.enable')
  const shot = await c.send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    writeFileSync('docs/screenshots/06-packaged.png', Buffer.from(shot.result.data, 'base64'))
    console.log('screenshot: docs/screenshots/06-packaged.png')
  }
  c.close()
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(800)
}
