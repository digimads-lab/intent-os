import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'

// ── RollbackNotification ──────────────────────────────────────────────────────

export interface RollbackNotificationProps {
  appId: string
  onDismiss: () => void
  autoHideMs?: number
}

export function RollbackNotification({
  appId: _appId,
  onDismiss,
  autoHideMs = 5000,
}: RollbackNotificationProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoHideMs)
    return () => clearTimeout(timer)
  }, [onDismiss, autoHideMs])

  return (
    <div
      data-testid="rollback-notification"
      className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 bg-slate-800 border border-green-500/40 rounded-xl shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-top-2 duration-200"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center shrink-0">
        <CheckCircle2 size={14} className="text-white" aria-hidden="true" />
      </div>

      <p className="text-sm font-medium text-slate-100 whitespace-nowrap">
        已回滚到修改前版本
      </p>

      <button
        type="button"
        onClick={onDismiss}
        data-testid="rollback-notification-dismiss"
        className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors ml-1"
        aria-label="关闭通知"
      >
        <X size={12} />
      </button>
    </div>
  )
}
