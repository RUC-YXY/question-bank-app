/** 清掉验证脚本写进去的坏路径（双反斜杠那条），保留用户真实的最近文档。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.env.APPDATA ?? '', '题库本', 'config.json')
const config = JSON.parse(readFileSync(file, 'utf8'))
const before = config.recentDocs.length
config.recentDocs = config.recentDocs.filter((doc) => !doc.path.includes('\\\\'))
writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
console.log(`recentDocs ${before} -> ${config.recentDocs.length}`)
