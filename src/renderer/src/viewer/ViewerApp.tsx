import { useCallback, useEffect, useState } from 'react'
import type { ViewerDocument } from '@shared/types'
import { api } from '@renderer/shared/api'
import { DocxViewer } from './DocxViewer'
import { PdfViewer } from './PdfViewer'
import { DocumentIcon, RefreshIcon } from './icons'
import { ToolbarButton, ToolbarTitle, formatError } from './ui'

type DocState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: ViewerDocument }

export function ViewerApp() {
  const [state, setState] = useState<DocState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    api.doc
      .viewerDocument()
      .then((doc) => {
        if (!alive) return
        setState(doc ? { status: 'ready', doc } : { status: 'empty' })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setState({ status: 'error', message: formatError('读取当前文档失败', err) })
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])

  return (
    <div className="viewer-shell">
      {state.status === 'ready' ? (
        state.doc.kind === 'pdf' ? (
          <PdfViewer path={state.doc.path} />
        ) : (
          <DocxViewer path={state.doc.path} />
        )
      ) : (
        <>
          <div className="viewer-toolbar">
            <ToolbarTitle path="" />
          </div>
          <div className="empty">
            {state.status === 'loading' && (
              <>
                <span className="spinner" />
                <div className="empty-text">正在读取当前窗口要打开的文档…</div>
              </>
            )}
            {state.status === 'empty' && (
              <>
                <div className="empty-icon">
                  <DocumentIcon />
                </div>
                <div className="empty-title">没有可阅读的文档</div>
                <div className="empty-text">
                  从主窗口打开一份 PDF 或 Word 文档后，这里会显示文档内容。
                </div>
              </>
            )}
            {state.status === 'error' && (
              <>
                <div className="empty-icon">
                  <DocumentIcon />
                </div>
                <div className="empty-title">读取文档信息失败</div>
                <div className="empty-text">{state.message}</div>
                <ToolbarButton label="重试" onClick={retry}>
                  <RefreshIcon />
                  重试
                </ToolbarButton>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
