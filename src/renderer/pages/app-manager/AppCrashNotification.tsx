import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

// ── AppCrashNotification ──────────────────────────────────────────────────────

export type RollbackPhase = 'rolling-back' | 'recovered'

export interface AppCrashNotificationProps {
  appName: string
  phase: RollbackPhase
}

export function AppCrashNotification({ appName, phase }: AppCrashNotificationProps) {
  const isRollingBack = phase === 'rolling-back'

  return (
    <div
      data-testid="app-crash-notification"
      className="flex items-start gap-3 px-4 py-3.5 bg-slate-800 border border-red-500/30 rounded-xl shadow-xl shadow-black/30"
      role="status"
      aria-live="assertive"
      aria-atomic="true"
    >
      {/* Icon */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isRollingBack ? 'bg-red-600/80' : 'bg-green-600'
        }`}
      >
        {isRollingBack ? (
          <AlertTriangle size={15} className="text-white" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={15} className="text-white" aria-hidden="true" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        {isRollingBack ? (
          <>
            <p className="text-sm font-medium text-slate-100 leading-snug">
              应用{' '}
              <span className="text-red-300 font-semibold">{appName}</span>{' '}
              在热更新后崩溃，正在自动回滚...
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Loader2 size={12} className="text-blue-400 animate-spin" aria-hidden="true" />
              <span className="text-xs text-slate-500">回滚中，请稍候</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-100 leading-snug">
              应用{' '}
              <span className="text-slate-300 font-semibold">{appName}</span>{' '}
              已自动回滚
            </p>
            <p className="text-xs text-green-400/80 mt-0.5">✓ 已恢复到修改前版本</p>
          </>
        )}
      </div>
    </div>
  )
}
