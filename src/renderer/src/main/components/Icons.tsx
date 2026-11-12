interface IconProps {
  size?: number
  className?: string
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true'
} as const

export function SearchIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </svg>
  )
}

export function CameraIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  )
}

export function DocIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  )
}

export function SettingsIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.4 7.8l1.9 1.1M17.7 15.1l1.9 1.1M3 12h2.2M18.8 12H21M4.4 16.2l1.9-1.1M17.7 8.9l1.9-1.1" />
    </svg>
  )
}

export function SlidersIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 7h8M16 7h4M4 12h4M12 12h8M4 17h8M16 17h4" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="14" cy="17" r="2" />
    </svg>
  )
}

export function RefreshIcon({ size = 14, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4h-4" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function PlusIcon({ size = 13, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function AlertIcon({ size = 13, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 4 3 20h18Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}

export function ImageOffIcon({ size = 22, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-5 4 4M4 4l16 16" />
    </svg>
  )
}

export function TagIcon({ size = 13, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M20 12.6 12.6 20a2 2 0 0 1-2.9 0L4 14.3V4h10.3l5.7 5.7a2 2 0 0 1 0 2.9Z" />
      <circle cx="8.5" cy="8.5" r="1.1" />
    </svg>
  )
}

export function BookIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M5 4h8.5A2.5 2.5 0 0 1 16 6.5V20H7.5A2.5 2.5 0 0 1 5 17.5Z" />
      <path d="M16 7h3v13" />
      <path d="M8.5 8.5h4M8.5 12h4" />
    </svg>
  )
}

/** 左侧文件栏的显示与隐藏 */
export function PanelIcon({ size = 15, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4.2" width="18" height="15.6" rx="2.2" />
      <path d="M9.6 4.2v15.6" />
    </svg>
  )
}
