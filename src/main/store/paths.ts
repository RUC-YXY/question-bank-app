import { app } from 'electron'
import { join } from 'node:path'

/** %APPDATA%/题库本 */
export function appRootDir(): string {
  return join(app.getPath('appData'), '题库本')
}

export function configPath(): string {
  return join(appRootDir(), 'config.json')
}

export function dataDir(): string {
  return join(appRootDir(), 'data')
}

export function questionsPath(): string {
  return join(dataDir(), 'questions.json')
}

export function categoriesPath(): string {
  return join(dataDir(), 'categories.json')
}

export function knowledgePath(): string {
  return join(dataDir(), 'knowledge.json')
}

export function imagesDir(): string {
  return join(dataDir(), 'images')
}
