import { CheckCircle2, AlertCircle, RotateCcw, Loader2, XCircle } from 'lucide-react'
import type { PipelineStageInfo } from '@intentos/shared-types'
import { useGenerationStore } from './generation-store'

function StageIcon({ status, index }: { status: PipelineStageInfo['status']; index: number }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={14} />
    case 'running':
      return <Loader2 size={14} className="animate-spin" />
    case 'failed':
      return <XCircle size={14} />
    case 'skipped':
      return <span className="text-xs">-</span>
    default:
      return <span>{index + 1}</span>
  }
}

function stageColor(status: PipelineStageInfo['status']): string {
  switch (status) {
    case 'done':
      return 'bg-green-600 text-white'
    case 'running':
      return 'bg-blue-600 text-white'
    case 'failed':
      return 'bg-red-600 text-white'
    case 'skipped':
      return 'bg-slate-600 text-slate-400'
    default:
      return 'bg-slate-700 text-slate-500'
  }
}

function stageLabelColor(status: PipelineStageInfo['status']): string {
  switch (status) {
    case 'done':
      return 'text-green-400'
    case 'running':
      return 'text-slate-200'
    case 'failed':
      return 'text-red-400'
    default:
      return 'text-slate-600'
  }
}

export function PipelineProgressView() {
  const {
    pipelineStages,
    pipelineOverallProgress,
    genError,
    genComplete,
    reset,
  } = useGenerationStore()

  // Fallback for when pipeline hasn't started yet
  const safeStages = pipelineStages ?? []
  const stages = safeStages.length > 0
    ? safeStages
    : [
        { id: 'mock' as const, label: 'Mock 预览', status: 'done' as const },
        { id: 'codegen' as const, label: '代码生成', status: 'waiting' as const },
        { id: 'compile' as const, label: '编译', status: 'waiting' as const },
        { id: 'test' as const, label: '运行测试', status: 'waiting' as const },
        { id: 'complete' as const, label: '完成', status: 'waiting' as const },
      ]

  const overallPct = genComplete ? 100 : pipelineOverallProgress

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

      {/* Multi-stage pipeline track */}
      <div className="flex flex-col gap-4">
        {stages.map((stage, i) => {
          const fill = stage.status === 'done' || stage.status === 'skipped'
            ? 100
            : stage.status === 'running' && stage.progress != null
              ? stage.progress
              : 0

          return (
            <div key={stage.id} className="flex items-center gap-3">
              {/* Stage icon */}
              <div
                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${stageColor(stage.status)}`}
              >
                <StageIcon status={stage.status} index={i} />
              </div>

              {/* Stage label + track */}
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className={`text-sm font-medium transition-colors ${stageLabelColor(stage.status)}`}>
                    {stage.label}
                  </span>
                  {stage.status === 'running' && (
                    <span className="text-xs tabular-nums text-blue-400 font-mono">
                      {Math.round(fill)}%
                    </span>
                  )}
                  {stage.status === 'done' && (
                    <span className="text-xs text-green-500/70">完成</span>
                  )}
                  {stage.status === 'failed' && (
                    <span className="text-xs text-red-400">{stage.error ?? '失败'}</span>
                  )}
                </div>

                {/* Message */}
                {stage.status === 'running' && stage.message && (
                  <p className="text-xs text-slate-400 truncate">{stage.message}</p>
                )}

                {/* Segment track */}
                <div className="h-1.5 rounded-full overflow-hidden bg-slate-800 border border-slate-700/60">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${
                      stage.status === 'done'
                        ? 'bg-green-500'
                        : stage.status === 'running'
                          ? 'bg-blue-500'
                          : stage.status === 'failed'
                            ? 'bg-red-500'
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

      {/* Overall progress */}
      <div className="flex justify-between items-center px-1">
        <p className="text-sm text-slate-400 leading-relaxed">
          {genComplete ? '所有阶段已完成' : '正在生成应用...'}
        </p>
        <span className="text-sm tabular-nums text-slate-400 font-mono shrink-0">
          {Math.round(overallPct)}%
        </span>
      </div>

      {/* Overall track */}
      <div className="h-1 rounded-full bg-slate-800 border border-slate-700/40 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${genComplete ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${overallPct}%` }}
        />
      </div>
    </div>
  )
}
