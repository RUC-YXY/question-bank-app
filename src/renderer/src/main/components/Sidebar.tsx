import { useMemo } from 'react'
import type { RecentDoc } from '@shared/types'
import { baseName, formatTime } from '@renderer/shared/api'
import { RefreshIcon } from './Icons'

interface SidebarProps {
  docs: RecentDoc[]
  activePath: string | null
  onOpen(path: string): void
  onRefresh(): void
}

interface DocGroup {
  dir: string
  title: string
  docs: RecentDoc[]
}

function groupDocs(docs: RecentDoc[]): DocGroup[] {
  const groups = new Map<string, DocGroup>()
  for (const doc of docs) {
    const segments = doc.path.split(/[\\/]/).filter(Boolean)
    segments.pop()
    const dir = segments.join('/')
    const title = segments.length > 0 ? segments[segments.length - 1] : '其他位置'
    const group = groups.get(dir)
    if (group) group.docs.push(doc)
    else groups.set(dir, { dir, title, docs: [doc] })
  }
  return [...groups.values()]
}

function docKind(path: string): 'pdf' | 'docx' | 'image' {
  const lower = path.toLowerCase()
  if (lower.endsWith('.docx')) return 'docx'
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lower)) return 'image'
  return 'pdf'
}

const KIND_LABEL: Record<ReturnType<typeof docKind>, string> = {
  pdf: 'PDF',
  docx: 'DOC',
  image: 'IMG'
}

export function Sidebar({ docs, activePath, onOpen, onRefresh }: SidebarProps) {
  const groups = useMemo(() => groupDocs(docs), [docs])

  return (
    <aside className="doc-sidebar">
      <div className="sidebar-header">
        <span>最近文档</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onRefresh} title="刷新列表">
          <RefreshIcon />
        </button>
      </div>

      <div className="sidebar-scroll">
        {groups.length === 0 && (
          <div className="empty">
            <div className="empty-title">还没有打开过文档</div>
            <div className="empty-text">点工具栏的「打开文档」选一份 PDF 或 DOCX，也可以直接拖进来</div>
          </div>
        )}

        {groups.map((group) => (
          <div className="sidebar-group" key={group.dir || '__root__'}>
            <div className="sidebar-group-title" title={group.dir}>
              {group.title}
            </div>
            {group.docs.map((doc) => {
              const kind = docKind(doc.path)
              return (
                <button
                  type="button"
                  key={doc.path}
                  className={`file-item${activePath === doc.path ? ' active' : ''}`}
                  onClick={() => onOpen(doc.path)}
                  title={doc.path}
                >
                  <span className={`file-icon ${kind}`}>{KIND_LABEL[kind]}</span>
                  <span className="file-name">{baseName(doc.path)}</span>
                  <span className="file-time">{formatTime(doc.openedAt)}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
