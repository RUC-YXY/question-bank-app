import type { Category, KnowledgePoint } from '@shared/types'
import {
  KIND_OPTIONS,
  RANGE_OPTIONS,
  STATUS_OPTIONS,
  type FilterState
} from '../filters'
import { FilterSelect } from './FilterSelect'
import { KnowledgePicker } from './KnowledgePicker'
import { CameraIcon, DocIcon, SearchIcon, SettingsIcon, SlidersIcon } from './Icons'

interface ToolbarProps {
  query: string
  onQueryChange(value: string): void
  filters: FilterState
  onPatch(patch: Partial<FilterState>): void
  categories: Category[]
  knowledge: KnowledgePoint[]
  onCapture(): void
  onOpenDocument(): void
  onOpenManage(): void
  onOpenSettings(): void
}

export function Toolbar({
  query,
  onQueryChange,
  filters,
  onPatch,
  categories,
  knowledge,
  onCapture,
  onOpenDocument,
  onOpenManage,
  onOpenSettings
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <SearchIcon />
        <input
          className="input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索题目、答案"
          title="搜索题干、答案、解析里出现的关键词"
          aria-label="搜索题目"
        />
      </div>

      <select
        className="select toolbar-select"
        aria-label="按分类筛选"
        title="按分类筛选"
        value={filters.categoryId}
        onChange={(event) => onPatch({ categoryId: event.target.value })}
      >
        <option value="">全部分类</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <KnowledgePicker
        items={knowledge}
        selectedIds={filters.knowledgeIds}
        mode={filters.knowledgeMode}
        onChange={(ids) => onPatch({ knowledgeIds: ids })}
        onModeChange={(mode) => onPatch({ knowledgeMode: mode })}
      />

      <FilterSelect
        label="按题目类型筛选"
        value={filters.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => onPatch({ kind })}
      />

      <FilterSelect
        label="按状态筛选"
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onPatch({ status })}
      />

      <FilterSelect
        label="按时间筛选"
        value={filters.range}
        options={RANGE_OPTIONS}
        onChange={(range) => onPatch({ range })}
      />

      <div className="toolbar-spacer" />

      <div className="toolbar-actions">
        <button type="button" className="btn" onClick={onCapture} title="录入新题（Alt+Shift+S）">
          <CameraIcon />
          录入新题
        </button>
        <button type="button" className="btn" onClick={onOpenDocument} title="打开 PDF 或 DOCX">
          <DocIcon />
          打开文档
        </button>
        <button type="button" className="btn" onClick={onOpenManage} title="管理分类与知识点">
          <SlidersIcon />
          管理
        </button>
        <button type="button" className="btn" onClick={onOpenSettings} title="打开设置">
          <SettingsIcon />
          设置
        </button>
      </div>
    </div>
  )
}
