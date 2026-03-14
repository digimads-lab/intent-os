import { CheckCircle2, AlertCircle, Loader2, RotateCcw, Circle } from 'lucide-react'
import type { UpdateStage } from '../../stores/modification-store'

// ── StageRow ──────────────────────────────────────────────────────────────────

interface StageRowProps {
  stage: UpdateStage
  isLast: boolean
}

function StageRow({ stage, isLast }: StageRowProps) {
  const { status, label, errorMessage } = stage

  return (
    <div className="flex items-start gap-3">
      {/* Icon column + connector line */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            status === 'done'
              ? 'bg-green-600 text-white'
              : status === 'active'
                ? 'bg-blue-600 text-white'
                : status === 'error'
                  ? 'bg-red-600/80 text-white'
                  : 'bg-slate-800 border border-slate-700 text-slate-600'
          }`}
        >
          {status === 'done' ? (
            <CheckCircle2 size={14} />
          ) : status === 'active' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : status === 'error' ? (
            <AlertCircle size={14} />
          ) : (
            <Circle size={12} />
          )}
        </div>

        {/* Vertical connector */}
        {!isLast && (
          <div
            className={`w-px flex-1 min-h-4 mt-1 transition-colors ${
              status === 'done' ? 'bg-green-600/40' : 'bg-slate-700'
            }`}
          />
        )}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0 pb-4">
        <p
          className={`text-sm font-medium transition-colors ${
            status === 'done'
              ? 'text-green-400'
              : status === 'active'
                ? 'text-slate-100'
                : status === 'error'
                  ? 'text-red-400'
                  : 'text-slate-600'
          }`}
        >
          {label}
        </p>

        {/* Error detail */}
        {status === 'error' && errorMessage && (
          <p className="text-xs text-red-400/80 mt-0.5 leading-snug break-all">
            {errorMessage}
          </p>
        )}

        {/* Active pulse text */}
        {status === 'active' && (
          <p className="text-xs text-blue-400/70 mt-0.5 animate-pulse">进行中…</p>
        )}

        {/* Done indicator */}
        {status === 'done' && (
          <p className="text-xs text-green-500/50 mt-0.5">完成</p>
        )}
      </div>
    </div>
  )
}

// ── UpdateProgress ────────────────────────────────────────────────────────────

interface UpdateProgressProps {
  stages: UpdateStage[]
  onRetry?: (() => void) | undefined
}

export function UpdateProgress({ stages, onRetry }: UpdateProgressProps) {
  const hasError = stages.some((s) => s.status === 'error')
  const allDone = stages.every((s) => s.status === 'done')

  return (
    <div className="flex flex-col gap-2">
      {/* Stage list */}
      <div className="flex flex-col">
        {stages.map((stage, i) => (
          <StageRow key={stage.key} stage={stage} isLast={i === stages.length - 1} />
        ))}
      </div>

      {/* Error actions */}
      {hasError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 text-sm rounded-lg transition-colors mt-2"
        >
          <RotateCcw size={14} />
          重试
        </button>
      )}

      {/* Success message */}
      {allDone && (
        <div className="flex items-start gap-2 px-4 py-3 bg-green-500/10 border border-green-500/30 rounded-xl mt-2">
          <CheckCircle2 size={16} className="text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-300">更新已完成</p>
            <p className="text-xs text-green-400/60 mt-0.5">应用已实时更新，无需重启。</p>
          </div>
        </div>
      )}
    </div>
  )
}
