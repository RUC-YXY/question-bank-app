/**
 * pdf.js 的 worker 用 Vite 的 `?url` 导入，TypeScript 不认识带查询串的模块说明符。
 * 这里只声明本项目实际用到的那一个模块，避免与全局通配声明冲突。
 */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const workerUrl: string
  export default workerUrl
}
