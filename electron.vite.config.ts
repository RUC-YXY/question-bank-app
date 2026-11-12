import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = __dirname

export default defineConfig({
  main: {
    // docx 要在主进程里生成 Word 导出，打进 bundle 而不是留成外部依赖，
    // 否则打包后 asar 里没有 node_modules，运行时会报 Cannot find module 'docx'。
    // katex / mathml2omml / fflate 是同一套导出链路上的依赖，一并打包。
    plugins: [externalizeDepsPlugin({ exclude: ['docx', 'katex', 'mathml2omml', 'fflate'] })],
    resolve: {
      alias: { '@shared': resolve(root, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(root, 'src/renderer/src'),
        '@shared': resolve(root, 'src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          viewer: resolve(root, 'src/renderer/viewer.html'),
          overlay: resolve(root, 'src/renderer/overlay.html'),
          settings: resolve(root, 'src/renderer/settings.html')
        }
      }
    }
  }
})
