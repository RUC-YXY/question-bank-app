import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Category,
  DbChangedPayload,
  DraftQuestion,
  KnowledgePoint,
  Question,
  QuestionFilter
} from '@shared/types'
import { categoriesPath, dataDir, imagesDir, knowledgePath, questionsPath } from './paths'
import { filterQuestions } from './search'

// ──────────────────────────── 原子写 ────────────────────────────

/** 先写 .tmp，fsync 落盘，再 rename 覆盖；绝不直接覆盖原文件。 */
async function atomicWrite(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  const json = JSON.stringify(data, null, 2)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(json, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, file)
}

/**
 * 读 JSON。文件不存在 → 空结构；解析失败 → 把坏文件改名备份后再初始化，
 * 绝不静默清空。
 */
async function readJson<T>(file: string, empty: () => T): Promise<T> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return empty()
    throw err
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object')
    return parsed as T
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = file.replace(/\.json$/, `.corrupt-${stamp}.json`)
    await fs.rename(file, backup).catch(() => undefined)
    return empty()
  }
}

// ──────────────────────────── Store ────────────────────────────

/** 兼容早期只有单张 imagePath 的数据：读进来统一成 imagePaths 数组 */
function normalizeQuestion(raw: unknown): Question {
  const rec = raw as Question & { imagePath?: string | null }
  const paths = Array.isArray(rec.imagePaths) ? [...rec.imagePaths] : []
  if (rec.imagePath && !paths.includes(rec.imagePath)) paths.push(rec.imagePath)
  const { imagePath: _legacy, ...rest } = rec
  return { ...rest, imagePaths: paths } as Question
}

export class Store {
  private questions: Question[] = []
  private categories: Category[] = []
  private knowledge: KnowledgePoint[] = []
  private recognizing = new Set<string>()
  /** 串行队列：所有写操作一次只跑一个 */
  private queue: Promise<unknown> = Promise.resolve()
  private initialized = false

  constructor(private readonly notify: (scope: DbChangedPayload['scope']) => void) {}

  async init(): Promise<void> {
    if (this.initialized) return
    await fs.mkdir(dataDir(), { recursive: true })
    await fs.mkdir(imagesDir(), { recursive: true })

    const rawQuestions = await readJson<unknown>(questionsPath(), () => [])
    const rawCategories = await readJson<unknown>(categoriesPath(), () => [])
    const rawKnowledge = await readJson<unknown>(knowledgePath(), () => [])

    this.questions = Array.isArray(rawQuestions) ? rawQuestions.map(normalizeQuestion) : []
    this.categories = Array.isArray(rawCategories) ? (rawCategories as Category[]) : []
    this.knowledge = Array.isArray(rawKnowledge) ? (rawKnowledge as KnowledgePoint[]) : []

    // 首次启动写一份空结构，保证磁盘布局可预期
    await Promise.all([
      fs.access(questionsPath()).catch(() => atomicWrite(questionsPath(), this.questions)),
      fs.access(categoriesPath()).catch(() => atomicWrite(categoriesPath(), this.categories)),
      fs.access(knowledgePath()).catch(() => atomicWrite(knowledgePath(), this.knowledge))
    ])

    this.initialized = true
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private persistQuestions(): Promise<void> {
    return atomicWrite(questionsPath(), this.questions)
  }

  // ── 读 ──

  private withRuntime(q: Question): Question {
    return this.recognizing.has(q.id) ? { ...q, recognizing: true } : q
  }

  list(filter: QuestionFilter): { items: Question[]; total: number } {
    const filtered = filterQuestions(this.questions, filter)
    const offset = Math.max(0, filter.offset)
    const limit = Math.max(0, filter.limit)
    return {
      items: filtered.slice(offset, offset + limit).map((q) => this.withRuntime(q)),
      total: filtered.length
    }
  }

  get(id: string): Question | null {
    const found = this.questions.find((q) => q.id === id)
    return found ? this.withRuntime(found) : null
  }

  facets(): { categories: Category[]; knowledge: KnowledgePoint[] } {
    return {
      categories: [...this.categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      knowledge: [...this.knowledge].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    }
  }

  // ── 题目写操作 ──

  save(draft: DraftQuestion & { id?: string }): Promise<Question> {
    return this.enqueue(async () => {
      const now = new Date().toISOString()
      if (draft.id) {
        const idx = this.questions.findIndex((q) => q.id === draft.id)
        if (idx >= 0) {
          const prev = this.questions[idx]
          const next: Question = {
            ...prev,
            ...draft,
            id: prev.id,
            status: 'confirmed',
            createdAt: prev.createdAt,
            updatedAt: now
          }
          this.questions[idx] = next
          await this.persistQuestions()
          this.notify('questions')
          return this.withRuntime(next)
        }
      }
      const created: Question = {
        ...draft,
        id: randomUUID(),
        status: 'confirmed',
        createdAt: now,
        updatedAt: now
      }
      this.questions.push(created)
      await this.persistQuestions()
      this.notify('questions')
      return this.withRuntime(created)
    })
  }

  update(id: string, patch: Partial<Question>): Promise<Question> {
    return this.enqueue(async () => {
      const idx = this.questions.findIndex((q) => q.id === id)
      if (idx < 0) throw new Error('题目不存在')
      const next: Question = {
        ...this.questions[idx],
        ...patch,
        id,
        updatedAt: new Date().toISOString()
      }
      delete next.recognizing
      this.questions[idx] = next
      await this.persistQuestions()
      this.notify('questions')
      return this.withRuntime(next)
    })
  }

  /** 内部用：不改变 status，可控制是否落盘（识别过程中的临时状态） */
  patchInPlace(id: string, patch: Partial<Question>, persist = true): Promise<Question> {
    return this.enqueue(async () => {
      const idx = this.questions.findIndex((q) => q.id === id)
      if (idx < 0) throw new Error('题目不存在')
      this.questions[idx] = { ...this.questions[idx], ...patch, id }
      if (persist) await this.persistQuestions()
      this.notify('questions')
      return this.withRuntime(this.questions[idx])
    })
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const before = this.questions.length
      this.questions = this.questions.filter((q) => q.id !== id)
      if (this.questions.length === before) return
      this.recognizing.delete(id)
      await this.persistQuestions()
      this.notify('questions')
    })
  }

  /** 截图后立即插入一条待识别草稿 */
  createDraft(input: {
    imagePath: string
    docPath?: string
    page?: number
  }): Promise<Question> {
    return this.enqueue(async () => {
      const now = new Date().toISOString()
      const draft: Question = {
        id: randomUUID(),
        kind: 'wrong',
        questionType: 'choice',
        stem: '',
        options: [],
        answer: '',
        analysis: '',
        categoryId: null,
        knowledgeIds: [],
        source: { docPath: input.docPath, page: input.page, capturedAt: now },
        imagePaths: [input.imagePath],
        rawModelOutput: '',
        confidence: 0,
        warnings: [],
        status: 'draft',
        createdAt: now,
        updatedAt: now
      }
      this.questions.push(draft)
      await this.persistQuestions()
      this.notify('questions')
      return this.withRuntime(draft)
    })
  }

  /** 往已有题目追加一张截图（题干图之外再补解答图等） */
  appendImage(id: string, imagePath: string): Promise<Question> {
    return this.enqueue(async () => {
      const idx = this.questions.findIndex((q) => q.id === id)
      if (idx < 0) throw new Error('题目不存在')
      const prev = this.questions[idx]
      const next: Question = {
        ...prev,
        imagePaths: [...prev.imagePaths, imagePath],
        updatedAt: new Date().toISOString()
      }
      this.questions[idx] = next
      await this.persistQuestions()
      this.notify('questions')
      return this.withRuntime(next)
    })
  }

  setRecognizing(id: string, on: boolean): void {
    if (on) this.recognizing.add(id)
    else this.recognizing.delete(id)
    this.notify('questions')
  }

  // ── 分类 ──

  createCategory(name: string): Promise<Category> {
    return this.enqueue(async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('分类名不能为空')
      if (this.categories.some((c) => c.name === trimmed)) throw new Error('分类已存在')
      const order = this.categories.reduce((max, c) => Math.max(max, c.order), 0) + 1
      const cat: Category = { id: randomUUID(), name: trimmed, order }
      this.categories.push(cat)
      await atomicWrite(categoriesPath(), this.categories)
      this.notify('facets')
      return cat
    })
  }

  renameCategory(id: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('分类名不能为空')
      const cat = this.categories.find((c) => c.id === id)
      if (!cat) throw new Error('分类不存在')
      if (this.categories.some((c) => c.id !== id && c.name === trimmed)) throw new Error('分类已存在')
      cat.name = trimmed
      await atomicWrite(categoriesPath(), this.categories)
      this.notify('facets')
    })
  }

  deleteCategory(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.categories = this.categories.filter((c) => c.id !== id)
      let touched = false
      this.questions = this.questions.map((q) => {
        if (q.categoryId !== id) return q
        touched = true
        return { ...q, categoryId: null }
      })
      await Promise.all([
        atomicWrite(categoriesPath(), this.categories),
        touched ? this.persistQuestions() : Promise.resolve()
      ])
      this.notify('facets')
      if (touched) this.notify('questions')
    })
  }

  // ── 知识点 ──

  createKnowledge(name: string): Promise<KnowledgePoint> {
    return this.enqueue(async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('知识点名不能为空')
      if (this.knowledge.some((k) => k.name === trimmed)) throw new Error('知识点已存在')
      const kp: KnowledgePoint = { id: randomUUID(), name: trimmed }
      this.knowledge.push(kp)
      await atomicWrite(knowledgePath(), this.knowledge)
      this.notify('facets')
      return kp
    })
  }

  renameKnowledge(id: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('知识点名不能为空')
      const kp = this.knowledge.find((k) => k.id === id)
      if (!kp) throw new Error('知识点不存在')
      if (this.knowledge.some((k) => k.id !== id && k.name === trimmed)) throw new Error('知识点已存在')
      kp.name = trimmed
      await atomicWrite(knowledgePath(), this.knowledge)
      this.notify('facets')
    })
  }

  deleteKnowledge(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.knowledge = this.knowledge.filter((k) => k.id !== id)
      let touched = false
      this.questions = this.questions.map((q) => {
        if (!q.knowledgeIds.includes(id)) return q
        touched = true
        return { ...q, knowledgeIds: q.knowledgeIds.filter((kid) => kid !== id) }
      })
      await Promise.all([
        atomicWrite(knowledgePath(), this.knowledge),
        touched ? this.persistQuestions() : Promise.resolve()
      ])
      this.notify('facets')
      if (touched) this.notify('questions')
    })
  }
}
