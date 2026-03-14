import { useEffect, useRef } from 'react'
import { Pencil, Loader2, CheckCircle2, ChevronRight } from 'lucide-react'
import {
  useModificationStore,
  type ModificationPlanChunk,
  type ModificationProgress,
  type IntentOSWithModification,
} from '../../stores/modification-store'
import { DiffView } from './DiffView'
import { UpdateProgress } from './UpdateProgress'
import { ErrorBanner } from '../../components/ErrorBanner'
import { RollbackNotification } from '../../components/RollbackNotification'

// ── Error message helpers ──────────────────────────────────────────────────────

function resolveErrorMessage(code: string, rawMessage: string): string {
  switch (code) {
    case 'APPLY_FAILED':
    case 'ROLLBACK_COMPLETE':
      return '热更新失败，已回滚到修改前版本'
    case 'SESSION_EXPIRED':
      return '修改会话已过期，请重新开始'
    case 'COMPILE_ERROR':
    case 'TS_ERROR':
      return rawMessage || 'TypeScript 编译错误，请检查代码'
    case 'PERMISSION_DENIED':
      return '权限不足，请检查应用权限设置'
    case 'NO_PROVIDER':
      return 'AI Provider 未配置，请前往设置页面配置'
    case 'PROVIDER_ERROR':
      return 'AI Provider 返回错误，请检查网络连接或 API Key'
    case 'PROCESS_CRASH':
      return '应用进程崩溃，正在尝试恢复'
    default:
      return rawMessage || '发生未知错误，请重试'
  }
}

// ── ModificationWindow ─────────────────────────────────────────────────────────

interface ModificationWindowProps {
  /** The SkillApp ID to modify */
  appId: string
  /** Human-readable app name shown in the header */
  appName: string
}

export function ModificationWindow({ appId, appName }: ModificationWindowProps) {
  const {
    sessionId,
    userIntent,
    planStatus,
    modifySession,
    updateProgress,
    error,
    structuredError,
    rollbackNotification,
    setUserIntent,
    startPlanning,
    confirmAndApply,
    cancel,
    reset,
    setPlanSession,
    setPlanError,
    setProgressStage,
    setError,
    clearRollbackNotification,
  } = useModificationStore()

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── IPC stream subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return

    const modification = (window.intentOS as unknown as IntentOSWithModification).modification

    // plan-chunk stream → build ModifySession
    const unsubChunk = modification.onPlanChunk(
      sessionId,
      (chunk: ModificationPlanChunk) => {
        if (chunk.phase === 'complete' && chunk.modifySession) {
          setPlanSession(chunk.modifySession)
        } else if (chunk.phase === 'error') {
          setPlanError(chunk.content)
        }
      },
    )

    // progress stream → update stage indicators
    const unsubProgress = modification.onProgress(
      sessionId,
      (progress: ModificationProgress) => {
        setProgressStage(progress.stage, progress.status, progress.message)
        if (progress.stage === 'done' && progress.status === 'done') {
          setProgressStage('done', 'done')
        }
      },
    )

    // error stream → surface structured error
    const unsubError = modification.onError(sessionId, (err) => {
      setError({ code: err.code, message: err.message })
      setPlanError(err.message)
    })

    return () => {
      unsubChunk()
      unsubProgress()
      unsubError()
    }
  }, [sessionId, setPlanSession, setPlanError, setProgressStage, setError])

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!userIntent.trim() || planStatus === 'planning') return
    try {
      await startPlanning(appId, appName, userIntent.trim())
    } catch {
      // error stored in store
    }
  }

  const handleApply = async () => {
    if (planStatus !== 'ready') return
    try {
      await confirmAndApply()
    } catch {
      // error stored in store
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleAnalyze()
    }
  }

  const isPlanning = planStatus === 'planning'
  const isApplying = planStatus === 'applying'
  const isReady = planStatus === 'ready'
  const isDone = planStatus === 'done' || updateProgress.every((s) => s.status === 'done')
  const isError = planStatus === 'error'
  const isIdle = planStatus === 'idle'

  // Resolve the error display from structured error or raw string
  const errorCode = structuredError?.code ?? 'ERROR'
  const errorMessage = structuredError
    ? resolveErrorMessage(structuredError.code, structuredError.message)
    : (error ?? '发生未知错误')

  // Whether the error is session-expired (dismiss-only, no retry)
  const isSessionExpired = structuredError?.code === 'SESSION_EXPIRED'

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Rollback notification (fixed position, auto-hides) */}
      {rollbackNotification && (
        <RollbackNotification
          appId={rollbackNotification.appId}
          onDismiss={clearRollbackNotification}
        />
      )}

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
          <Pencil size={15} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            修改 SkillApp
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {appName}
          </p>
        </div>
      </div>

      {/* Main card */}
      <div
        data-testid="modification-error"
        className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6 flex flex-col gap-6 max-w-2xl w-full mx-auto"
      >

        {/* ── Phase 1: intent input ──────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-slate-300">
            描述修改意图
          </label>
          <textarea
            ref={textareaRef}
            value={userIntent}
            onChange={(e) => setUserIntent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如：添加一个数据导出功能，支持导出为 CSV 格式…"
            disabled={isPlanning || isApplying || isDone}
            rows={4}
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/60 transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              按 <kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-500 font-mono text-xs">⌘ Enter</kbd> 快速分析
            </p>
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!userIntent.trim() || isPlanning || isApplying || isDone}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isPlanning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  分析中…
                </>
              ) : (
                <>
                  分析
                  <ChevronRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Phase 2: plan review ───────────────────────────────────────── */}
        {(isReady || isApplying || isDone) && modifySession && (
          <>
            {/* Divider */}
            <div className="h-px bg-slate-700/60" />

            {/* Description */}
            <div className="flex items-start gap-2">
              <CheckCircle2 size={15} className="text-green-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200">增量方案已生成</p>
                {modifySession.description && (
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {modifySession.description}
                  </p>
                )}
              </div>
            </div>

            {/* DiffView */}
            <DiffView modules={modifySession.modules} />

            {/* Apply button — only visible before applying */}
            {isReady && (
              <button
                type="button"
                onClick={() => void handleApply()}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600/90 hover:bg-green-600 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <CheckCircle2 size={16} />
                应用更新
              </button>
            )}
          </>
        )}

        {/* ── Phase 3: update progress ───────────────────────────────────── */}
        {(isApplying || isDone) && (
          <>
            <div className="h-px bg-slate-700/60" />
            <div>
              <p className="text-sm font-medium text-slate-300 mb-4">更新进度</p>
              <UpdateProgress
                stages={updateProgress}
                onRetry={isError ? reset : undefined}
              />
            </div>
          </>
        )}

        {/* ── Error state ────────────────────────────────────────────────── */}
        {isError && (
          <ErrorBanner
            code={errorCode}
            message={errorMessage}
            {...(isSessionExpired ? { onDismiss: reset } : { onRetry: reset })}
          />
        )}
      </div>

      {/* Footer status */}
      <div className="max-w-2xl w-full mx-auto flex items-center justify-between px-1">
        <p className="text-xs text-slate-600">
          {isIdle && '输入修改意图，然后点击「分析」生成增量方案。'}
          {isPlanning && 'AI 正在分析代码库，生成增量修改方案…'}
          {isReady && '方案已就绪，确认后将开始热更新。'}
          {isApplying && '正在应用热更新…'}
          {isDone && '热更新完成，应用已实时刷新。'}
          {isError && '操作失败，请检查错误信息后重试。'}
        </p>

        {/* Cancel button — visible during active operations */}
        {(isPlanning || isApplying) && (
          <button
            type="button"
            onClick={() => void cancel()}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors ml-4 whitespace-nowrap"
          >
            取消
          </button>
        )}

        {/* Reset after done */}
        {(isDone || isError) && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors ml-4 whitespace-nowrap"
          >
            重新开始
          </button>
        )}
      </div>
    </div>
  )
}
