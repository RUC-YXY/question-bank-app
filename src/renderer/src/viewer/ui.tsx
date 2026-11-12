import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { baseName, errorMessage } from '@renderer/shared/api'

interface ToolbarTitleProps {
  /** 完整路径，hover 时显示；为空时显示 fallback */
  path: string
  fallback?: string
}

/** 工具栏左侧的文件名：只显示 basename，title 里放完整路径。 */
export function ToolbarTitle({ path, fallback = '题库本阅读器' }: ToolbarTitleProps) {
  if (!path) {
    return <span className="viewer-title">{fallback}</span>
  }
  return (
    <span className="viewer-title" title={path}>
      {baseName(path)}
    </span>
  )
}

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍标签，同时作为 hover 提示 */
  label: string
  /** 只放图标的方形按钮 */
  iconOnly?: boolean
  children?: ReactNode
}

/** 阅读窗口工具栏按钮：默认是幽灵小按钮，图标按钮带 aria-label。 */
export function ToolbarButton({
  label,
  iconOnly = false,
  className,
  children,
  ...rest
}: ToolbarButtonProps) {
  const classes = ['btn', iconOnly ? 'btn-ghost btn-icon' : 'btn-ghost btn-sm', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" title={label} aria-label={label} className={classes} {...rest}>
      {children}
    </button>
  )
}

/** 把异常翻译成给用户看的中文句子；没有细节时只留前缀。 */
export function formatError(prefix: string, err: unknown): string {
  const detail = errorMessage(err)
  return detail ? `${prefix}：${detail}` : prefix
}
