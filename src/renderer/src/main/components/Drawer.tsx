import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, DraftQuestion, KnowledgePoint, Question } from '@shared/types'
import { api, errorMessage, imageUrl } from '@renderer/shared/api'
import { toast } from '@renderer/shared/toast'
import { statusBadge } from '../status'
import {
  emptyForm,
  emptyMeta,
  formFromQuestion,
  metaFromQuestion,
  type DrawerFormState,
  type DrawerMeta
} from '../drawerModel'
import { DrawerForm } from './DrawerForm'
import { CloseIcon, ImageOffIcon, PlusIcon } from './Icons'

interface DrawerProps {
  question: Question
  categories: Category[]
  knowledge: KnowledgePoint[]
  /** 当前列表里除这道题以外还剩几条草稿 */
  draftSiblings: number
  onRefresh(): Promise<void>
  onClose(): void
}

export function Drawer({
  question,
  categories,
  knowledge,
  draftSiblings,
  onRefresh,
  onClose
}: DrawerProps) {
  const [form, setForm] = useState<DrawerFormState>(() => formFromQuestion(question))
  const [meta, setMeta] = useState<DrawerMeta>(() => metaFromQuestion(question))
  const [base, setBase] = useState(() => JSON.stringify(formFromQuestion(question)))
  /** null 表示正在录入一道新题，没有对应记录 */
  const [editingId, setEditingId] = useState<string | null>(question.id)
  const [saving, setSaving] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  /** 题目上的截图列表，第一张是题干图；删除与追加后都回写到主进程 */
  const [images, setImages] = useState<string[]>(() => [...question.imagePaths])
  /** 当前查看大图的下标 */
  const [selectedImage, setSelectedImage] = useState(0)
  const [imageBusy, setImageBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  /** 截图期间把抽屉收出视口，否则遮罩抓到的是被抽屉挡住的主窗口 */
  const [collapsed, setCollapsed] = useState(false)
  const [recognizingBusy, setRecognizingBusy] = useState(false)

  const dirty = JSON.stringify(form) !== base
  const badge = statusBadge(question)
  /** 识别中的草稿先不保存：主进程识别完成后会回写内容，保存会互相覆盖 */
  const recognizing =
    (question.recognizing === true || recognizingBusy) && question.status === 'draft'
  /** 保存并继续录入之后没有对应记录，图片区按空处理，避免把上一题的图带进新草稿 */
  const imageList = editingId ? images : []

  // 识别刚完成、用户还没动过表单时，把识别结果同步进来
  const wasRecognizingRef = useRef(question.recognizing === true)
  useEffect(() => {
    const wasRecognizing = wasRecognizingRef.current
    wasRecognizingRef.current = question.recognizing === true
    if (!wasRecognizing || question.recognizing) return
    if (editingId !== question.id || dirty) return

    const nextForm = formFromQuestion(question)
    setForm(nextForm)
    setBase(JSON.stringify(nextForm))
    setMeta(metaFromQuestion(question))
  }, [question, editingId, dirty])

  // 列表刷新（删除、追加截图、db:changed）后，把主进程上的最新图片同步进来
  useEffect(() => {
    setImages([...question.imagePaths])
  }, [question.imagePaths])

  // 图片数量变了就重设选中态：追加后直接看新图，删除后夹到有效范围
  const previousImageCountRef = useRef(images.length)
  useEffect(() => {
    const count = images.length
    const previous = previousImageCountRef.current
    previousImageCountRef.current = count
    setSelectedImage((current) => {
      if (count === 0) return 0
      if (count > previous) return count - 1
      return Math.min(current, count - 1)
    })
  }, [images.length])

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('有未保存的修改，确定关闭吗？')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [requestClose])

  const buildPayload = (): DraftQuestion & { id?: string } => {
    const payload: DraftQuestion & { id?: string } = {
      kind: form.kind,
      questionType: form.questionType,
      stem: form.stem,
      options: form.options.map((option) => ({ label: option.label, text: option.text })),
      answer: form.answer,
      analysis: form.analysis,
      categoryId: form.categoryId,
      knowledgeIds: form.knowledgeIds,
      source: meta.source,
      imagePaths: imageList,
      rawModelOutput: meta.rawModelOutput,
      confidence: meta.confidence,
      warnings: meta.warnings
    }
    if (editingId) payload.id = editingId
    return payload
  }

  /** 把这道题当前所有截图一起交给 AI，结果回填到同一条记录 */
  const handleRecognize = async (): Promise<void> => {
    if (!editingId || recognizingBusy) return
    setRecognizingBusy(true)
    try {
      const result = await api.vision.recognizeQuestion(editingId)
      if (result.questions === 0) {
        toast(result.warnings[0] ?? '没有识别到题目，换个范围再截一次', 'error')
      } else {
        toast(`识别到 ${result.questions} 道题，已填入表单`, 'success')
      }
      await onRefresh()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setRecognizingBusy(false)
    }
  }

  const handleSave = async (continueNext: boolean): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      // 还没识别过（题干空、用户也没改）但有截图：先识别再入库，避免存一条空题
      if (editingId && !form.stem.trim() && !dirty && imageList.length > 0) {
        try {
          await api.vision.recognizeQuestion(editingId)
        } catch (err) {
          toast(`识别失败：${errorMessage(err)}`, 'error')
          return
        }
        await api.question.update(editingId, { status: 'confirmed' })
        toast('已识别并入库', 'success')
        await onRefresh()
        if (!continueNext) {
          onClose()
          return
        }
        setEditingId(null)
        const nextForm = emptyForm(form.kind, form.questionType)
        setForm(nextForm)
        setBase(JSON.stringify(nextForm))
        setMeta(emptyMeta())
        setImages([])
        return
      }

      await api.question.save(buildPayload())
      toast('已保存，状态为已入库', 'success')
      await onRefresh()

      if (!continueNext) {
        onClose()
        return
      }
      if (draftSiblings <= 0) {
        toast('已保存，列表里没有其它待确认草稿了', 'success')
        onClose()
        return
      }

      const next = emptyForm(form.kind, form.questionType)
      setForm(next)
      setBase(JSON.stringify(next))
      setMeta(emptyMeta())
      setEditingId(null)
      setZoomed(false)
      setImages([])
      setSelectedImage(0)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async (): Promise<void> => {
    if (!editingId) {
      onClose()
      return
    }
    const message =
      question.status === 'confirmed'
        ? '这道题已入库，删除后无法恢复，确定丢弃？'
        : '丢弃会删除这条草稿，确定吗？'
    if (!window.confirm(message)) return

    setSaving(true)
    try {
      await api.question.delete(editingId)
      toast('已丢弃', 'success')
      await onRefresh()
      onClose()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveImage = async (path: string): Promise<void> => {
    if (!editingId || imageBusy) return
    const targetId = editingId
    const remaining = images.filter((item) => item !== path)
    if (!window.confirm('删除这张截图？删除后无法恢复。')) return

    const before = images
    setImageBusy(true)
    // 先本地生效，失败再还原，避免等一轮刷新才看到变化
    setImages(remaining)
    try {
      await api.question.update(targetId, { imagePaths: remaining })
      toast('已删除这张截图', 'success')
      await onRefresh()
    } catch (err) {
      setImages(before)
      toast(errorMessage(err), 'error')
    } finally {
      setImageBusy(false)
    }
  }

  const handleAppendImage = async (): Promise<void> => {
    if (!editingId || capturing) return
    const targetId = editingId
    setCapturing(true)
    // 先把抽屉收出视口：遮罩抓的是整屏图，抽屉盖在上面就截不到下面的文档
    setCollapsed(true)
    try {
      // 等收起动画走完再开遮罩，否则抓到的还是抽屉没退干净的画面
      await new Promise((resolve) => window.setTimeout(resolve, 280))
      // 传题目 id：截完的图追加到这道题，而不是新建草稿
      await api.capture.start(targetId)
      // 截图期间主窗口被遮罩挡住，回来后再拉一次，保证多图列表立刻对齐
      await onRefresh()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setCollapsed(false)
      setCapturing(false)
    }
  }

  const selectedPath = imageList[selectedImage] ?? imageList[0] ?? null

  return (
    <>
      <div
        className={`drawer-overlay${collapsed ? ' collapsed' : ''}`}
        onClick={requestClose}
      />
      <aside
        className={`drawer${collapsed ? ' collapsed' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="编辑题目"
      >
        <header className="drawer-header">
          <span className="drawer-title">{editingId ? '编辑题目' : '录入新题'}</span>
          <span className={`tag ${editingId ? badge.className : 'tag-accent'}`}>
            {editingId && badge.spinning && <i className="spinner" />}
            {editingId ? badge.label : '未保存'}
          </span>
          <div className="drawer-header-spacer" />
          <button type="button" className="btn btn-ghost btn-icon" onClick={requestClose} title="关闭">
            <CloseIcon />
          </button>
        </header>

        <div className="drawer-body">
          <div className="drawer-image-col">
            {imageList.length > 0 ? (
              <>
                <div className="drawer-thumbs">
                  <div className="drawer-thumbs-scroll" role="tablist" aria-label="这道题的截图">
                    {imageList.map((path, index) => (
                      <div
                        key={path}
                        className={`drawer-thumb${index === selectedImage ? ' active' : ''}`}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={index === selectedImage}
                          className="drawer-thumb-pick"
                          title={`查看第 ${index + 1} 张截图`}
                          onClick={() => {
                            setSelectedImage(index)
                            setZoomed(false)
                          }}
                        >
                          <img src={imageUrl(path)} alt={`第 ${index + 1} 张截图`} loading="lazy" />
                        </button>
                        <button
                          type="button"
                          className="drawer-thumb-remove"
                          title="删除这张截图"
                          aria-label={`删除第 ${index + 1} 张截图`}
                          disabled={imageBusy}
                          onClick={() => void handleRemoveImage(path)}
                        >
                          <CloseIcon size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm drawer-thumb-add"
                    title="截取一张新图并追加到这道题"
                    disabled={capturing || !editingId}
                    onClick={() => void handleAppendImage()}
                  >
                    <PlusIcon />
                    {capturing ? '截图中…' : '追加截图'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="把这道题的所有截图一起交给 AI 识别"
                    disabled={recognizing || !editingId || imageList.length === 0}
                    onClick={() => void handleRecognize()}
                  >
                    {recognizing ? <span className="spinner" /> : null}
                    {recognizing ? '识别中…' : '识别'}
                  </button>
                </div>

                <div
                  className={`drawer-image-pane${zoomed ? ' zoomed' : ''}`}
                  onClick={() => setZoomed((value) => !value)}
                  title="点击放大或还原"
                >
                  {selectedPath && (
                    <img src={imageUrl(selectedPath)} alt={`第 ${selectedImage + 1} 张截图`} />
                  )}
                </div>
              </>
            ) : (
              <div className="drawer-image-pane drawer-image-blank">
                <div className="drawer-image-empty">
                  <ImageOffIcon size={26} />
                  <span>还没有截图，点下面「追加截图」</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={capturing || !editingId}
                    onClick={() => void handleAppendImage()}
                  >
                    <PlusIcon />
                    {capturing ? '截图中…' : '追加截图'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <DrawerForm
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            categories={categories}
            knowledge={knowledge}
            confidence={meta.confidence}
            warnings={meta.warnings}
            rawModelOutput={meta.rawModelOutput}
          />
        </div>

        <footer className="drawer-footer">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void handleDiscard()}
            disabled={saving}
          >
            丢弃
          </button>
          <div className="drawer-footer-spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => void handleSave(true)}
            disabled={saving || recognizing}
            title={recognizing ? '正在识别，稍后再保存' : undefined}
          >
            保存并继续录入
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave(false)}
            disabled={saving || recognizing}
            title={recognizing ? '正在识别，稍后再保存' : undefined}
          >
            保存并关闭
          </button>
        </footer>
      </aside>
    </>
  )
}
