import { AlertTriangle, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// ── AIProviderOfflineBanner ───────────────────────────────────────────────────

export function AIProviderOfflineBanner() {
  const navigate = useNavigate()

  return (
    <div
      data-testid="ai-provider-offline-banner"
      className="flex items-center gap-3 px-4 py-3 bg-amber-500/15 border border-amber-500/35 rounded-xl"
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle size={16} className="text-amber-400 shrink-0" aria-hidden="true" />

      <p className="flex-1 text-sm text-amber-300 leading-snug">
        AI Provider 不可用 — 请检查网络连接或 API Key 配置
      </p>

      <button
        type="button"
        onClick={() => void navigate('/settings')}
        data-testid="ai-provider-offline-settings-link"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
        aria-label="前往设置页面配置 AI Provider"
      >
        <Settings size={12} />
        前往设置
      </button>
    </div>
  )
}
