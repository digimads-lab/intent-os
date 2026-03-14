import { useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus, FilePen, FileText } from 'lucide-react'
import type { ModifyModule } from '../../stores/modification-store'

// ── helpers ───────────────────────────────────────────────────────────────────

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

// ── ModuleRow ─────────────────────────────────────────────────────────────────

interface ModuleRowProps {
  module: ModifyModule
  dimmed?: boolean
}

function ModuleRow({ module, dimmed }: ModuleRowProps) {
  const isAdd = module.classification === 'add'
  const isModify = module.classification === 'modify'
  const isUnchanged = module.classification === 'unchanged'

  return (
    <div
      className={`flex items-start gap-2.5 py-2 px-3 rounded-lg transition-colors ${
        dimmed
          ? 'opacity-40'
          : isAdd
            ? 'bg-green-500/5 hover:bg-green-500/10'
            : isModify
              ? 'bg-amber-500/5 hover:bg-amber-500/10'
              : 'hover:bg-slate-800/40'
      }`}
    >
      {/* File icon */}
      <div className={`shrink-0 mt-0.5 ${
        isAdd ? 'text-green-400' : isModify ? 'text-amber-400' : 'text-slate-600'
      }`}>
        {isAdd ? (
          <FilePlus size={14} />
        ) : isModify ? (
          <FilePen size={14} />
        ) : (
          <FileText size={14} />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-mono truncate ${
          isAdd ? 'text-green-300' : isModify ? 'text-amber-300' : 'text-slate-600'
        }`}>
          {basename(module.filePath)}
        </p>
        {module.changeSummary && !isUnchanged && (
          <p className={`text-xs mt-0.5 leading-snug truncate ${
            isAdd ? 'text-green-500/70' : 'text-amber-500/70'
          }`}>
            {module.changeSummary}
          </p>
        )}
        {!module.changeSummary && !isUnchanged && (
          <p className="text-xs mt-0.5 text-slate-500 truncate">{module.name}</p>
        )}
      </div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string
  count: number
  colorClass: string
  dotClass: string
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
}

function SectionHeader({
  label,
  count,
  colorClass,
  dotClass,
  collapsible,
  collapsed,
  onToggle,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={collapsible ? onToggle : undefined}
      className={`flex items-center gap-2 w-full text-left mb-2 group ${
        collapsible ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
      <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass}`}>
        {label}
      </span>
      <span className={`text-xs tabular-nums ml-0.5 ${colorClass} opacity-60`}>
        ({count})
      </span>
      {collapsible && (
        <span className={`ml-auto ${colorClass} opacity-50 group-hover:opacity-80 transition-opacity`}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
      )}
    </button>
  )
}

// ── DiffView ──────────────────────────────────────────────────────────────────

interface DiffViewProps {
  modules: ModifyModule[]
}

export function DiffView({ modules }: DiffViewProps) {
  const [unchangedCollapsed, setUnchangedCollapsed] = useState(true)

  const added = modules.filter((m) => m.classification === 'add')
  const modified = modules.filter((m) => m.classification === 'modify')
  const unchanged = modules.filter((m) => m.classification === 'unchanged')

  const hasAdd = added.length > 0
  const hasModify = modified.length > 0
  const hasUnchanged = unchanged.length > 0

  // Three-column layout only when we have multiple categories with content
  const useColumns = (hasAdd ? 1 : 0) + (hasModify ? 1 : 0) >= 2

  if (!useColumns) {
    // Single-column fallback
    return (
      <div className="flex flex-col gap-3">
        {hasAdd && (
          <div>
            <SectionHeader
              label="新增"
              count={added.length}
              colorClass="text-green-400"
              dotClass="bg-green-500"
            />
            <div className="flex flex-col gap-0.5">
              {added.map((m) => <ModuleRow key={m.filePath} module={m} />)}
            </div>
          </div>
        )}
        {hasModify && (
          <div>
            <SectionHeader
              label="修改"
              count={modified.length}
              colorClass="text-amber-400"
              dotClass="bg-amber-500"
            />
            <div className="flex flex-col gap-0.5">
              {modified.map((m) => <ModuleRow key={m.filePath} module={m} />)}
            </div>
          </div>
        )}
        {hasUnchanged && (
          <div>
            <SectionHeader
              label="不变"
              count={unchanged.length}
              colorClass="text-slate-500"
              dotClass="bg-slate-600"
              collapsible
              collapsed={unchangedCollapsed}
              onToggle={() => setUnchangedCollapsed((v) => !v)}
            />
            {!unchangedCollapsed && (
              <div className="flex flex-col gap-0.5">
                {unchanged.map((m) => <ModuleRow key={m.filePath} module={m} dimmed />)}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Three-column grid */}
      <div className="grid grid-cols-3 gap-3">
        {/* 新增 column */}
        <div className="flex flex-col">
          <SectionHeader
            label="新增"
            count={added.length}
            colorClass="text-green-400"
            dotClass="bg-green-500"
          />
          <div className="flex flex-col gap-0.5 flex-1">
            {added.length === 0 ? (
              <p className="text-xs text-slate-700 italic px-3 py-2">无</p>
            ) : (
              added.map((m) => <ModuleRow key={m.filePath} module={m} />)
            )}
          </div>
        </div>

        {/* 修改 column */}
        <div className="flex flex-col">
          <SectionHeader
            label="修改"
            count={modified.length}
            colorClass="text-amber-400"
            dotClass="bg-amber-500"
          />
          <div className="flex flex-col gap-0.5 flex-1">
            {modified.length === 0 ? (
              <p className="text-xs text-slate-700 italic px-3 py-2">无</p>
            ) : (
              modified.map((m) => <ModuleRow key={m.filePath} module={m} />)
            )}
          </div>
        </div>

        {/* 不变 column */}
        <div className="flex flex-col">
          <SectionHeader
            label="不变"
            count={unchanged.length}
            colorClass="text-slate-500"
            dotClass="bg-slate-600"
            collapsible
            collapsed={unchangedCollapsed}
            onToggle={() => setUnchangedCollapsed((v) => !v)}
          />
          {!unchangedCollapsed && (
            <div className="flex flex-col gap-0.5">
              {unchanged.map((m) => <ModuleRow key={m.filePath} module={m} dimmed />)}
            </div>
          )}
          {unchangedCollapsed && unchanged.length > 0 && (
            <p className="text-xs text-slate-700 italic px-3 py-2">
              {unchanged.length} 个文件已折叠
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
