import { useRef, useState, useEffect } from 'react'
import { MessageSquare, CheckCircle2, Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import type { PlanChunk } from '@intentos/shared-types'
import { useGenerationStore } from './generation-store'

export function PlanDialog() {
  const {
    planChunks,
    planResult,
    isPlanning,
    genError,
    refinePlan,
    requestMock,
    reset,
  } = useGenerationStore()

  const [feedback, setFeedback] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)
  const [appName, setAppName] = useState('')
  const [refineError, setRefineError] = useState<string | null>(null)
  const [isRefining, setIsRefining] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new chunks arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [planChunks])

  // Prefill app name from plan result
  useEffect(() => {
    if (planResult?.appName && !appName) {
      setAppName(planResult.appName)
    }
  }, [planResult, appName])

  const planText = planChunks.map((c: PlanChunk) => c.content).join('')

  const handleRefine = async () => {
    if (!feedback.trim() || isPlanning || isRefining) return
    setRefineError(null)
    setIsRefining(true)
    try {
      await refinePlan(feedback.trim())
      setFeedback('')
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRefining(false)
    }
  }

  const handleConfirm = async () => {
    setShowNameInput(false)
    try {
      await requestMock()
    } catch {
      // error stored in genError
    }
  }

  const isBusy = isPlanning || isRefining

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Plan output area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto bg-slate-800/60 border border-slate-700 rounded-xl p-4"
        style={{ maxHeight: '340px' }}
      >
        {planText.length === 0 && isPlanning ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" />
            <span>正在规划中...</span>
          </div>
        ) : planText.length === 0 ? (
          <p className="text-sm text-slate-500">规划内容将在这里显示...</p>
        ) : (
          <pre className="text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed">
            {planText}
          </pre>
        )}

        {/* Streaming cursor */}
        {isPlanning && planText.length > 0 && (
          <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
        )}
      </div>

      {/* Plan result summary */}
      {planResult && !isPlanning && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-green-400 shrink-0" />
            <span className="text-sm font-medium text-slate-200">规划完成</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-slate-500 mb-1">应用名称</p>
              <p className="text-slate-200 font-medium">{planResult.appName}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-1">模块数量</p>
              <p className="text-slate-200 font-medium">{planResult.modules.length} 个</p>
            </div>
          </div>
          {planResult.description && (
            <p className="text-xs text-slate-400 leading-relaxed">{planResult.description}</p>
          )}
          {planResult.modules.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {planResult.modules.map((m) => (
                <span
                  key={m.filePath}
                  className="px-2 py-0.5 bg-slate-700/80 text-xs text-slate-300 rounded-md"
                >
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {(genError || refineError) && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{genError?.message ?? refineError}</span>
        </div>
      )}

      {/* App name input overlay */}
      {showNameInput && (
        <div className="flex flex-col gap-2 p-4 bg-slate-800 border border-blue-500/30 rounded-xl">
          <label className="text-sm font-medium text-slate-300">为应用起个名字</label>
          <input
            type="text"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirm()
              if (e.key === 'Escape') setShowNameInput(false)
            }}
            placeholder={planResult?.appName ?? '我的应用'}
            autoFocus
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowNameInput(false)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <ChevronRight size={13} />
              开始生成
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      {!showNameInput && (
        <>
          {/* Refine feedback input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) void handleRefine()
              }}
              placeholder="输入反馈，进一步优化方案..."
              disabled={isBusy}
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleRefine()}
              disabled={!feedback.trim() || isBusy}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isRefining ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <MessageSquare size={14} />
              )}
              继续优化
            </button>
          </div>

          {/* Confirm button */}
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isPlanning || !planText}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600/90 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={16} />
            确认方案，预览界面
          </button>

          {/* Reset link */}
          <button
            type="button"
            onClick={reset}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors self-center"
          >
            重新开始
          </button>
        </>
      )}
    </div>
  )
}
