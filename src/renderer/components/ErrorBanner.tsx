import { AlertCircle, RotateCcw, X } from 'lucide-react'

// ── ErrorBanner ───────────────────────────────────────────────────────────────

export interface ErrorBannerProps {
  code: string
  message: string
  onRetry?: (() => void) | undefined
  onDismiss?: (() => void) | undefined
}

export function ErrorBanner({ code, message, onRetry, onDismiss }: ErrorBannerProps) {
  return (
    <div
      data-testid="error-banner"
      className="flex items-start gap-3 px-4 py-3 bg-red-600 rounded-xl"
      role="alert"
      aria-live="assertive"
    >
      <AlertCircle size={16} className="text-white shrink-0 mt-0.5" aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <code className="block text-xs font-mono text-red-200 mb-0.5">{code}</code>
        <p className="text-sm text-white leading-snug break-words">{message}</p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="error-banner-retry"
            className="flex items-center gap-1 px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg transition-colors"
            aria-label="重试"
          >
            <RotateCcw size={11} />
            重试
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            data-testid="error-banner-dismiss"
            className="w-6 h-6 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
            aria-label="关闭"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
