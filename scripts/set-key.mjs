/**
 * 把 API Key 写进应用配置，并用一张真实截图跑通 vision:recognize 全链路。
 * 用法：$env:DEEPSEEK_API_KEY='sk-...'; node scripts/set-key.mjs
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error('缺少 DEEPSEEK_API_KEY')
  process.exit(1)
}

const PORT = 9339
const APPDATA = process.env.APPDATA
const imagesDir = join(APPDATA, '题库本', 'data', 'images')
mkdirSync(imagesDir, { recursive: true })
const testImage = join(imagesDir, 'vision-test.png')
copyFileSync('sample/crop/sample-questions-p1-clip.png', testImage)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('release/win-unpacked/题库本.exe', [`--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore'
})

const kill = () => {
  if (child.pid === undefined) return
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

async function evalOn(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  const msg = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP 超时')), 90000)
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === 1) {
        clearTimeout(t)
        res(m)
      }
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
  if (msg.result?.exceptionDetails) {
    throw new Error(msg.result.exceptionDetails.text ?? '页面异常')
  }
  return msg.result?.result?.value
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
  await sleep(1500)

  const before = await evalOn(target, `window.api.config.get()`)
  console.log('before.hasApiKey =', before.hasApiKey, '| model =', before.apiModel)

  await evalOn(target, `window.api.config.set({ apiKey: ${JSON.stringify(key)} })`)
  const after = await evalOn(target, `window.api.config.get()`)
  console.log('after.hasApiKey  =', after.hasApiKey)

  const started = Date.now()
  const result = await evalOn(
    target,
    `window.api.vision.recognize('images/vision-test.png')`
  )
  const elapsed = Date.now() - started
  console.log(`recognize: ${elapsed}ms, questions = ${result?.questions?.length ?? 0}`)
  if (result?.questions?.length) {
    const q = result.questions[0]
    console.log('first.stem =', String(q.stem).slice(0, 90))
    console.log('first.options =', q.options?.length, '| type =', q.questionType, '| conf =', q.confidence)
    console.log('all stems:')
    for (const item of result.questions) {
      console.log('  -', String(item.stem).replace(/\s+/g, ' ').slice(0, 70))
    }
  }
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
