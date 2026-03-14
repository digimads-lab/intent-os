import { Trash2 } from 'lucide-react'
import type { SkillRegistration } from '@intentos/shared-types'

interface SkillCardProps {
  skill: SkillRegistration
  onUninstall: (skill: SkillRegistration) => void
}

const STATUS_STYLES: Record<SkillRegistration['status'], string> = {
  active: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  inactive: 'bg-slate-600/40 text-slate-400 border border-slate-600/50',
  error: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

const STATUS_DOT: Record<SkillRegistration['status'], string> = {
  active: 'bg-emerald-400',
  inactive: 'bg-slate-500',
  error: 'bg-red-400',
}

const STATUS_LABEL: Record<SkillRegistration['status'], string> = {
  active: '运行中',
  inactive: '未激活',
  error: '错误',
}

const CAP_DISPLAY_LIMIT = 3

export function SkillCard({ skill, onUninstall }: SkillCardProps) {
  const visibleCaps = skill.capabilities.slice(0, CAP_DISPLAY_LIMIT)
  const hiddenCount = skill.capabilities.length - CAP_DISPLAY_LIMIT

  return (
    <div className="group relative bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-3 hover:border-slate-600 hover:bg-slate-800/80 transition-all duration-200">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-slate-100 font-semibold text-base leading-snug truncate">
              {skill.name}
            </h3>
            <span className="shrink-0 text-xs font-mono px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600">
              v{skill.version}
            </span>
          </div>
          {skill.author && (
            <p className="text-xs text-slate-500 mt-0.5">by {skill.author}</p>
          )}
        </div>

        {/* Status badge */}
        <span
          className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[skill.status]}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[skill.status]}`} />
          {STATUS_LABEL[skill.status]}
        </span>
      </div>

      {/* Description */}
      {skill.description && (
        <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">
          {skill.description}
        </p>
      )}

      {/* Capabilities */}
      {skill.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleCaps.map((cap) => (
            <span
              key={cap}
              className="text-xs px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20"
            >
              {cap}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-slate-700 text-slate-500 border border-slate-600">
              +{hiddenCount} 更多
            </span>
          )}
        </div>
      )}

      {/* Footer: path + uninstall button */}
      <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-slate-700/60">
        <p className="text-xs text-slate-600 truncate font-mono" title={skill.directoryPath}>
          {skill.directoryPath}
        </p>

        <button
          onClick={() => onUninstall(skill)}
          className="shrink-0 flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors duration-150 px-2 py-1 rounded-lg hover:bg-red-500/10"
          title="卸载此 Skill"
        >
          <Trash2 size={13} />
          <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            卸载
          </span>
        </button>
      </div>
    </div>
  )
}
