/**
 * 冒烟验证：启动打包后的应用，用 CDP 检查主窗口是否真的渲染出界面、IPC 是否可用。
 * 用法：node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9333
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin =
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'

const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
  env,
  stdio: 'ignore',
  cwd: process.cwd()
})

function killTree() {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
}

async function cdp(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 超时')), 15000)
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
  return result
}

try {
  let targets = null
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      if (res.ok) {
        targets = await res.json()
        break
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }

  if (!targets) throw new Error('CDP 没有在 40 秒内就绪')

  const main = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!main) throw new Error(`找不到主窗口页面，现有页面：${targets.map((t) => t.url).join(', ')}`)

  const check = await cdp(
    main,
    `(() => ({
      title: document.title,
      hasShell: !!document.querySelector('.app-shell'),
      hasToolbar: !!document.querySelector('.toolbar'),
      hasSidebar: !!document.querySelector('.sidebar'),
      hasCardArea: !!document.querySelector('.card-scroll, .empty'),
      requireIsUndefined: typeof window.require === 'undefined',
      apiKeys: Object.keys(window.api ?? {}),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)
    }))()`
  )

  const value = check.result?.result?.value
  if (!value) {
    console.error('CDP 返回异常：', JSON.stringify(check).slice(0, 600))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify(value, null, 2))
    const ok =
      value.hasShell && value.hasToolbar && value.hasSidebar && value.requireIsUndefined
    if (!ok) process.exitCode = 1
  }
} catch (err) {
  console.error('冒烟失败：', err.message)
  process.exitCode = 1
} finally {
  killTree()
  await sleep(500)
}
