/** 清空最近文档列表（测试期间会留下一些临时路径）。 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9346
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

async function evalOn(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  const msg = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('超时')), 15000)
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
  if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.text ?? '页面异常')
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
  await sleep(1200)

  const before = await evalOn(target, `window.api.config.get().then(c => c.recentDocs.length)`)
  await evalOn(target, `window.api.config.set({ recentDocs: [] })`)
  const after = await evalOn(target, `window.api.config.get().then(c => c.recentDocs.length)`)
  const hasKey = await evalOn(target, `window.api.config.get().then(c => c.hasApiKey)`)
  console.log(JSON.stringify({ before, after, hasApiKey: hasKey }))
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  kill()
  await sleep(600)
}
