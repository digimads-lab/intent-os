import { useEffect } from 'react'
import { Wand2, MessageSquare, Eye, Zap, CheckCircle2 } from 'lucide-react'
import type { PlanChunk, GenProgressChunk, PipelineStatus } from '@intentos/shared-types'
import { useGenerationStore } from './generation-store'
import { SkillSelector } from './SkillSelector'
import { PlanDialog } from './PlanDialog'
import { MockPreviewView } from './MockPreviewView'
import { PipelineProgressView } from './PipelineProgressView'
import { ProgressView } from './ProgressView'

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { phase: 1 as const, icon: Wand2, label: '选择 Skill' },
  { phase: 2 as const, icon: MessageSquare, label: '规划方案' },
  { phase: 3 as const, icon: Eye, label: 'Mock 预览' },
  { phase: 4 as const, icon: Zap, label: '生成应用' },
  { phase: 5 as const, icon: CheckCircle2, label: '完成' },
]

type Phase = 1 | 2 | 3 | 4 | 5

function StepIndicator({ current }: { current: Phase }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map(({ phase, icon: Icon, label }, i) => {
        const isDone = phase < current
        const isActive = phase === current
        return (
          <div key={phase} className="flex items-center">
            {/* Node */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  isDone
                    ? 'bg-green-600 text-white'
                    : isActive
                      ? 'bg-blue-600 text-white ring-4 ring-blue-600/20'
                      : 'bg-slate-800 border border-slate-700 text-slate-600'
                }`}
              >
                {isDone ? (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L4 7L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <Icon size={14} />
                )}
              </div>
              <span
                className={`text-xs whitespace-nowrap transition-colors ${
                  isActive ? 'text-slate-200 font-medium' : isDone ? 'text-green-400' : 'text-slate-600'
                }`}
              >
                {label}
              </span>
            </div>

            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-10 mb-5 mx-1 transition-colors ${
                  phase < current ? 'bg-green-600/50' : 'bg-slate-700'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GenerationWindow() {
  const {
    phase,
    sessionId,
    appendPlanChunk,
    setPlanResult,
    setIsPlanning,
    setMockHtml,
    setPipelineStatus,
    setGenProgress,
    setIsGenerating,
    setGenError,
    setGenComplete,
    setPhase,
  } = useGenerationStore()

  // Subscribe to IPC streams whenever we have a sessionId
  useEffect(() => {
    if (!sessionId) return

    const generation = window.intentOS.generation as {
      onPlanChunk: (sessionId: string, cb: (chunk: PlanChunk) => void) => () => void
      onGenProgress: (sessionId: string, cb: (chunk: GenProgressChunk) => void) => () => void
      onMockHtml: (sessionId: string, cb: (data: { html: string; isPartial: boolean }) => void) => () => void
      onPipelineStatus: (sessionId: string, cb: (status: PipelineStatus) => void) => () => void
    }

    const aiProvider = window.intentOS.aiProvider

    // ── plan-chunk ──────────────────────────────────────────────────────────
    const unsubPlanChunk = generation.onPlanChunk(sessionId, (chunk: PlanChunk) => {
      appendPlanChunk(chunk)
      if (chunk.phase === 'complete' && chunk.planResult) {
        setPlanResult(chunk.planResult)
        setIsPlanning(false)
      } else if (chunk.phase === 'error') {
        setIsPlanning(false)
        setGenError({ message: chunk.content, code: 'PLAN_CHUNK_ERROR' })
      }
    })

    // ── plan-complete ────────────────────────────────────────────────────────
    const unsubPlanComplete = aiProvider.onPlanComplete(sessionId, () => {
      setIsPlanning(false)
    })

    // ── plan-error ───────────────────────────────────────────────────────────
    const unsubPlanError = aiProvider.onPlanError(sessionId, (err) => {
      setIsPlanning(false)
      setGenError({ message: err.message, code: err.code })
    })

    // ── mock-html ────────────────────────────────────────────────────────────
    const unsubMockHtml = generation.onMockHtml(sessionId, (data: { html: string; isPartial: boolean }) => {
      setMockHtml(data.html, data.isPartial)
    })

    // ── pipeline-status ──────────────────────────────────────────────────────
    const unsubPipelineStatus = generation.onPipelineStatus(sessionId, (status: PipelineStatus) => {
      setPipelineStatus(status.stages, status.overallProgress, status.currentStage)

      // Auto-transition to phase 5 when pipeline completes
      const completeStage = status.stages.find((s) => s.id === 'complete')
      if (completeStage?.status === 'done') {
        setIsGenerating(false)
        setGenComplete(true)
        setPhase(5)
      }
    })

    // ── gen-progress ─────────────────────────────────────────────────────────
    const unsubGenProgress = generation.onGenProgress(sessionId, (chunk: GenProgressChunk) => {
      setGenProgress({
        stage: chunk.stage as 'codegen' | 'compile' | 'bundle' | 'complete' | 'error',
        progress: chunk.progress,
        message: chunk.message,
      })
      if (chunk.stage === 'complete') {
        setIsGenerating(false)
        setGenComplete(true)
      } else if (chunk.stage === 'error') {
        setIsGenerating(false)
        setGenError({ message: chunk.message, code: 'GEN_PROGRESS_ERROR' })
      }
    })

    // ── gen-complete ─────────────────────────────────────────────────────────
    const unsubGenComplete = aiProvider.onGenComplete(sessionId, () => {
      setIsGenerating(false)
      setGenComplete(true)
    })

    // ── gen-error ────────────────────────────────────────────────────────────
    const unsubGenError = aiProvider.onGenError(sessionId, (err) => {
      setIsGenerating(false)
      setGenError({ message: err.message, code: err.code })
    })

    return () => {
      unsubPlanChunk()
      unsubPlanComplete()
      unsubPlanError()
      unsubMockHtml()
      unsubPipelineStatus()
      unsubGenProgress()
      unsubGenComplete()
      unsubGenError()
    }
  }, [
    sessionId,
    appendPlanChunk,
    setPlanResult,
    setIsPlanning,
    setMockHtml,
    setPipelineStatus,
    setGenProgress,
    setIsGenerating,
    setGenError,
    setGenComplete,
    setPhase,
  ])

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-100">生成应用</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          选择 Skill，描述意图，让 AI 为你生成可运行的应用
        </p>
      </div>

      {/* Wizard container */}
      <div className="flex flex-col gap-6 max-w-2xl w-full mx-auto">
        {/* Step indicator */}
        <div className="flex justify-center">
          <StepIndicator current={phase} />
        </div>

        {/* Phase panels */}
        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-6">
          {phase === 1 && <SkillSelector />}
          {phase === 2 && <PlanDialog />}
          {phase === 3 && <MockPreviewView />}
          {phase === 4 && <PipelineProgressView />}
          {phase === 5 && <PipelineProgressView />}
        </div>
      </div>
    </div>
  )
}
