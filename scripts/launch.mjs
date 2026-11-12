/**
 * 启动包装：清除 ELECTRON_RUN_AS_NODE。
 * 该变量存在时 Electron 会退化成纯 Node 进程，require('electron') 只返回一个路径字符串，
 * 主进程在 registerSchemesAsPrivileged 处直接崩掉。
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
