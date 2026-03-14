import { useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import type { SkillRegistration } from '@intentos/shared-types'

interface UninstallDialogProps {
  skill: SkillRegistration
  hasApps: boolean
  appNames: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function UninstallDialog({
  skill,
  hasApps,
  appNames,
  onClose,
  onConfirm,
}: UninstallDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !loading) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-6 mx-4">
        {/* Close */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-700 disabled:opacity-50"
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        {/* Icon + title */}
        <div className="flex flex-col items-center text-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle size={22} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-slate-100 font-semibold text-base">确认卸载 Skill</h2>
            <p className="text-slate-400 text-sm mt-1">
              即将卸载{' '}
              <span className="text-slate-200 font-medium">
                {skill.name}
              </span>{' '}
              <span className="text-slate-500 font-mono text-xs">v{skill.version}</span>
            </p>
          </div>
        </div>

        {/* Warning: has dependent apps */}
        {hasApps && appNames.length > 0 && (
          <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/25 p-4">
            <p className="text-amber-400 text-xs font-medium mb-2">
              以下应用正在引用此 Skill，卸载后可能无法正常运行：
            </p>
            <ul className="flex flex-col gap-1">
              {appNames.map((name) => (
                <li key={name} className="text-xs text-amber-300/80 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Confirmation note */}
        <p className="text-xs text-slate-500 text-center mb-5">
          此操作不可撤销，Skill 元数据将从系统中移除。
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                卸载中…
              </>
            ) : (
              '确认卸载'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
