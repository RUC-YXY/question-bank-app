import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RawRecognizedQuestion, RecognitionResult } from '@shared/types'

/** 开发时读项目 resources/，打包后读 process.resourcesPath/resources */
export function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 无 key 或 useMock 为真时走这里：读本地夹具，随机延迟 800ms，
 * 让 UI 全流程在无网络条件下可验收。
 */
export async function mockRecognition(): Promise<RecognitionResult> {
  const file = join(resourcesDir(), 'mock', 'recognition.json')
  const [text] = await Promise.all([fs.readFile(file, 'utf8'), sleep(800)])
  const parsed = JSON.parse(text) as {
    questions?: RawRecognizedQuestion[]
    warnings?: string[]
  }
  return {
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    raw: text,
    provider: 'mock'
  }
}
