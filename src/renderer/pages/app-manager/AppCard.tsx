import { Trash2, Play, Square, Focus, Loader2 } from 'lucide-react'
import type { AppRegistration, AppStatus } from '@intentos/shared-types'

interface AppCardProps {
  app: AppRegistration
  onLaunch: (appId: string) => void
  onStop: (appId: string) => void
  onFocus: (appId: string) => void
  onUninstall: (appId: string) => void
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_DOT: Record<AppStatus, string> = {
  registered:   'bg-slate-500',
  running:      'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.4)]',
  starting:     'bg-amber-400',
  restarting:   'bg-amber-400',
  uninstalling: 'bg-amber-400',
  stopped:      'bg-slate-500',
  crashed:      'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.4)]',
}

const STATUS_BADGE: Record<AppStatus, string> = {
  registered:   'bg-slate-600/40 text-slate-400 border border-slate-600/50',
  running:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  starting:     'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  restarting:   'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  uninstalling: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  stopped:      'bg-slate-600/40 text-slate-400 border border-slate-600/50',
  crashed:      'bg-red-500/15 text-red-400 border border-red-500/30',
}

const STATUS_LABEL: Record<AppStatus, string> = {
  registered:   '未启动',
  running:      '运行中',
  starting:     '启动中',
  restarting:   '重启中',
  uninstalling: '卸载中',
  stopped:      '已停止',
  crashed:      '已崩溃',
}

const TRANSITIONAL: AppStatus[] = ['starting', 'restarting', 'uninstalling']

export function AppCard({ app, onLaunch, onStop, onFocus, onUninstall }: AppCardProps) {
  const isTransitional = TRANSITIONAL.includes(app.status)
  const isRunning = app.status === 'running'
  const isStopped = app.status === 'registered' || app.status === 'stopped' || app.status === 'crashed'

  return (
    <div className="group relative bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-3 hover:border-slate-600 hover:bg-slate-800/80 transition-all duration-200">

      {/* Uninstall button — top right absolute */}
      <button
        onClick={() => onUninstall(app.id)}
        className="absolute top-3.5 right-3.5 flex items-center justify-center w-7 h-7 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors duration-150 opacity-0 group-hover:opacity-100"
        title="卸载此应用"
      >
        <Trash2 size={13} />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 pr-8">
        <div className="flex-1 min-w-0">
          <h3 className="text-slate-100 font-semibold text-base leading-snug truncate">
            {app.name}
          </h3>
          {app.intent && (
            <p className="text-sm text-slate-400 mt-1 leading-relaxed line-clamp-2">
              {app.intent}
            </p>
          )}
        </div>
      </div>

      {/* Skill badges */}
      {app.skillIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {app.skillIds.map((skillId) => (
            <span
              key={skillId}
              className="text-xs px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono"
            >
              {skillId}
            </span>
          ))}
        </div>
      )}

      {/* Footer: status + actions */}
      <div className="flex items-center justify-between gap-2 pt-2 mt-auto border-t border-slate-700/60">

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-4 h-4">
            {isTransitional ? (
              <Loader2 size={13} className="text-amber-400 animate-spin" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[app.status]}`} />
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[app.status]}`}>
            {STATUS_LABEL[app.status]}
          </span>
          {app.crashCount > 0 && (
            <span className="text-xs text-red-400/70">
              已崩溃 {app.crashCount} 次
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {isStopped && (
            <button
              onClick={() => onLaunch(app.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              <Play size={12} />
              启动
            </button>
          )}

          {isRunning && (
            <>
              <button
                onClick={() => onFocus(app.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg transition-colors"
              >
                <Focus size={12} />
                聚焦
              </button>
              <button
                onClick={() => onStop(app.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-red-400 bg-slate-700 hover:bg-red-500/10 border border-slate-600 hover:border-red-500/30 rounded-lg transition-colors"
              >
                <Square size={12} />
                停止
              </button>
            </>
          )}

          {isTransitional && (
            <button
              disabled
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-slate-700/50 border border-slate-700 rounded-lg cursor-not-allowed"
            >
              <Loader2 size={12} className="animate-spin" />
              处理中
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
