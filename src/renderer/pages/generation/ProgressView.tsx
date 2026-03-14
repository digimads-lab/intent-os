import { CheckCircle2, AlertCircle, RotateCcw, Loader2 } from 'lucide-react'
import type { GenProgress } from './generation-store'
import { useGenerationStore } from './generation-store'

// ── Stage configuration ────────────────────────────────────────────────────────

const STAGES: Array<{
  key: GenProgress['stage']
  label: string
  range: [number, number]
}> = [
  { key: 'codegen', label: '代码生成', range: [0, 40] },
  { key: 'compile', label: '编译', range: [40, 80] },
  { key: 'bundle', label: '打包', range: [80, 100] },
]

function getStageIndex(stage: GenProgress['stage']): number {
  return STAGES.findIndex((s) => s.key === stage)
}

function stageStatus(
  stageKey: GenProgress['stage'],
  currentStage: GenProgress['stage'],
  isComplete: boolean,
): 'done' | 'active' | 'pending' {
  if (isComplete) return 'done'
  const currentIdx = getStageIndex(currentStage)
  const stageIdx = getStageIndex(stageKey)
  if (stageIdx < currentIdx) return 'done'
  if (stageIdx === currentIdx) return 'active'
  return 'pending'
}

// Compute per-segment fill percentage (0-100) for the segment track
function segmentFill(
  stageKey: GenProgress['stage'],
  globalProgress: number,
  isComplete: boolean,
): number {
  if (isComplete) return 100
  const stage = STAGES.find((s) => s.key === stageKey)
  if (!stage) return 0
  const [lo, hi] = stage.range
  if (globalProgress <= lo) return 0
  if (globalProgress >= hi) return 100
  return ((globalProgress - lo) / (hi - lo)) * 100
}

export function ProgressView() {
  const { genProgress, genError, genComplete, reset } = useGenerationStore()

  const progress = genProgress ?? { stage: 'codegen' as const, progress: 0, message: '准备中...' }
  const { stage: currentStage, progress: globalPct, message } = progress

  return (
    <div className="flex flex-col gap-6">
      {/* Error card */}
      {genError && (
        <div className="flex flex-col gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-300">生成失败</p>
              <p className="text-xs text-red-400 mt-0.5 break-all">{genError.message}</p>
              <p className="text-xs text-red-500/60 mt-1 font-mono">错误码：{genError.code}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 text-sm rounded-lg transition-colors"
          >
            <RotateCcw size={14} />
            重新开始
          </button>
        </div>
      )}

      {/* Success card */}
      {genComplete && !genError && (
        <div className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
          <CheckCircle2 size={18} className="text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-300">应用生成成功！</p>
            <p className="text-xs text-green-400/70 mt-0.5">
              你的应用已准备就绪，可在应用管理页面中启动。
            </p>
          </div>
        </div>
      )}

      {/* Three-stage pipeline track */}
      <div className="flex flex-col gap-4">
        {STAGES.map(({ key, label }, i) => {
          const status = stageStatus(key, currentStage, genComplete)
          const fill = segmentFill(key, globalPct, genComplete)

          return (
            <div key={key} className="flex items-center gap-3">
              {/* Stage number / check icon */}
              <div
                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  status === 'done'
                    ? 'bg-green-600 text-white'
                    : status === 'active'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-500'
                }`}
              >
                {status === 'done' ? (
                  <CheckCircle2 size={14} />
                ) : status === 'active' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>

              {/* Stage label + track */}
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span
                    className={`text-sm font-medium transition-colors ${
                      status === 'done'
                        ? 'text-green-400'
                        : status === 'active'
                          ? 'text-slate-200'
                          : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </span>
                  {status === 'active' && (
                    <span className="text-xs tabular-nums text-blue-400 font-mono">
                      {Math.round(fill)}%
                    </span>
                  )}
                  {status === 'done' && (
                    <span className="text-xs text-green-500/70">完成</span>
                  )}
                </div>

                {/* Segment track */}
                <div className="h-1.5 rounded-full overflow-hidden bg-slate-800 border border-slate-700/60">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${
                      status === 'done'
                        ? 'bg-green-500'
                        : status === 'active'
                          ? 'bg-blue-500'
                          : 'bg-transparent'
                    }`}
                    style={{ width: `${fill}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Overall percentage */}
      <div className="flex justify-between items-center px-1">
        <p className="text-sm text-slate-400 leading-relaxed">
          {genComplete ? '所有阶段已完成' : message}
        </p>
        <span className="text-sm tabular-nums text-slate-400 font-mono shrink-0">
          {genComplete ? 100 : Math.round(globalPct)}%
        </span>
      </div>

      {/* Overall track */}
      <div className="h-1 rounded-full bg-slate-800 border border-slate-700/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${genComplete ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${genComplete ? 100 : globalPct}%` }}
        />
      </div>
    </div>
  )
}
