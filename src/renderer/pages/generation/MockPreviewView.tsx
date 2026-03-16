import { useState } from 'react'
import { MessageSquare, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { useGenerationStore } from './generation-store'

export function MockPreviewView() {
  const {
    mockHtml,
    isMockPartial,
    genError,
    planResult,
    approveMock,
    confirmGenerate,
    reviseMock,
    reset,
  } = useGenerationStore()

  const [feedback, setFeedback] = useState('')
  const [isRevising, setIsRevising] = useState(false)

  const handleRevise = async () => {
    if (!feedback.trim() || isMockPartial || isRevising) return
    setIsRevising(true)
    try {
      await reviseMock(feedback.trim())
      setFeedback('')
    } catch {
      // error stored in genError
    } finally {
      setIsRevising(false)
    }
  }

  const handleApprove = async () => {
    try {
      await approveMock()
      // After mock is approved, start the generation pipeline.
      // appName comes from planResult (set during Phase 2).
      const appName = planResult?.appName || 'my-app'
      await confirmGenerate(appName)
    } catch {
      // error stored in genError
    }
  }

  const isBusy = isMockPartial || isRevising

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Mock preview iframe */}
      <div className="flex-1 min-h-0 bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden relative" style={{ minHeight: '320px' }}>
        {mockHtml ? (
          <iframe
            srcDoc={mockHtml}
            sandbox="allow-same-origin"
            className="w-full h-full border-0"
            title="Mock 预览"
            style={{ minHeight: '320px' }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>正在生成界面预览...</span>
          </div>
        )}

        {/* Partial indicator */}
        {isMockPartial && mockHtml && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-blue-600/80 text-white text-xs rounded-lg">
            <Loader2 size={12} className="animate-spin" />
            生成中...
          </div>
        )}
      </div>

      {/* Error display */}
      {genError && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          <span>{genError.message}</span>
        </div>
      )}

      {/* Revise feedback input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void handleRevise()
          }}
          placeholder="输入反馈，修改界面预览..."
          disabled={isBusy}
          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleRevise()}
          disabled={!feedback.trim() || isBusy}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-200 text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed whitespace-nowrap"
        >
          {isRevising ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <MessageSquare size={14} />
          )}
          修改预览
        </button>
      </div>

      {/* Approve button */}
      <button
        type="button"
        onClick={() => void handleApprove()}
        disabled={isBusy || !mockHtml}
        className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600/90 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
      >
        <CheckCircle2 size={16} />
        确认预览，开始生成
      </button>

      {/* Reset link */}
      <button
        type="button"
        onClick={reset}
        className="text-xs text-slate-600 hover:text-slate-400 transition-colors self-center"
      >
        重新开始
      </button>
    </div>
  )
}
