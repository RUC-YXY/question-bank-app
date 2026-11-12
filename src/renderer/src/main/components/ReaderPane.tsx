import { useCallback } from 'react'
import type { ViewerDocument } from '@shared/types'
import { api, baseName, errorMessage } from '@renderer/shared/api'
import { toast } from '@renderer/shared/toast'
import { DocxViewer } from '@renderer/viewer/DocxViewer'
import { ImageViewer } from '@renderer/viewer/ImageViewer'
import { PdfViewer } from '@renderer/viewer/PdfViewer'
import { CloseIcon, DocIcon } from './Icons'
// 阅读器组件依赖这份样式表。独立窗口在 viewer/main.tsx 里 import，
// 主窗口这条链没人引，所以这里再引一次，让 .viewer-shell 等规则生效。
import '../../viewer/viewer.css'

interface ReaderPaneProps {
  doc: ViewerDocument | null
  /** 是否处于并排双栏状态 */
  split: boolean
  /** 当前焦点栏，决定新打开的文档落在哪一边 */
  focused: boolean
  onFocus(): void
  onClose(): void
  onToggleSplit(): void
}

function ExternalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M12 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4h3" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.9" y="2.6" width="5.2" height="10.8" rx="1" />
      <rect x="8.9" y="2.6" width="5.2" height="10.8" rx="1" />
    </svg>
  )
}

const KIND_LABEL: Record<ViewerDocument['kind'], string> = {
  pdf: 'PDF',
  docx: 'DOC',
  image: 'IMG'
}

/** 主窗口内嵌的阅读器：顶部窄条（文件名、分栏、在新窗口打开、关闭）+ PDF/DOCX/图片 */
export function ReaderPane({
  doc,
  split,
  focused,
  onFocus,
  onClose,
  onToggleSplit
}: ReaderPaneProps) {
  const openInWindow = useCallback((): void => {
    if (!doc) return
    void api.doc.openViewer(doc.path).catch((err: unknown) => {
      toast(errorMessage(err), 'error')
    })
  }, [doc])

  return (
    <section
      className={`reader-pane${focused ? ' focused' : ''}`}
      aria-label="阅读器"
      onPointerDown={onFocus}
    >
      <div className="reader-bar">
        {doc ? (
          <>
            <span className={`file-icon ${doc.kind}`}>{KIND_LABEL[doc.kind]}</span>
            <span className="reader-name" title={doc.path}>
              {baseName(doc.path)}
            </span>
          </>
        ) : (
          <span className="reader-name reader-name-empty">未打开文档</span>
        )}

        <span className="toolbar-spacer" />

        <button
          type="button"
          className={`btn btn-ghost btn-icon btn-sm${split ? ' active' : ''}`}
          title={split ? '关闭分栏' : '并排查看两个文档'}
          aria-label={split ? '关闭分栏' : '并排查看两个文档'}
          onClick={onToggleSplit}
        >
          <SplitIcon />
        </button>

        {doc && doc.kind !== 'image' && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="在新窗口打开"
            aria-label="在新窗口打开"
            onClick={openInWindow}
          >
            <ExternalIcon />
          </button>
        )}

        {doc && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            title="关闭阅读器"
            aria-label="关闭阅读器"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {doc ? (
        <div className="viewer-shell reader-viewer">
          {doc.kind === 'pdf' ? (
            <PdfViewer key={doc.path} path={doc.path} />
          ) : doc.kind === 'docx' ? (
            <DocxViewer key={doc.path} path={doc.path} />
          ) : (
            <ImageViewer key={doc.path} path={doc.path} />
          )}
        </div>
      ) : (
        <div className="empty reader-empty">
          <div className="empty-icon">
            <DocIcon size={22} />
          </div>
          <div className="empty-title">还没有打开文档</div>
          <div className="empty-text">
            {split ? '在左列选一份文档打开到这一栏' : '左侧选一份文档，或点工具栏的「打开文档」'}
          </div>
        </div>
      )}
    </section>
  )
}
