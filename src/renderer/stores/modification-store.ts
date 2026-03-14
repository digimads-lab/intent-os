import { create } from 'zustand'

// ── ModifySession ─────────────────────────────────────────────────────────────
// Local type — mirrors the ModifySession produced by M-05, transmitted via
// modification:plan-chunk stream.  Not in @intentos/shared-types yet.

export interface ModifyModule {
  /** Source-relative file path, e.g. "src/app/pages/ConfigPage.jsx" */
  filePath: string
  /** Human-readable module name */
  name: string
  /** One-line description of the change (only present for "modify" modules) */
  changeSummary?: string
  /** How this module is classified relative to the requested change */
  classification: 'add' | 'modify' | 'unchanged'
}

export interface ModifySession {
  sessionId: string
  appId: string
  /** Plain-text summary of what the AI plans to do */
  description: string
  /** All modules in the app, classified by impact */
  modules: ModifyModule[]
}

// ── UpdateStage ───────────────────────────────────────────────────────────────

export type UpdateStageKey = 'backup' | 'codegen' | 'compile' | 'push' | 'done'

export interface UpdateStage {
  key: UpdateStageKey
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  errorMessage?: string | undefined
}

const DEFAULT_STAGES: UpdateStage[] = [
  { key: 'backup',  label: '备份',     status: 'pending' },
  { key: 'codegen', label: '生成代码', status: 'pending' },
  { key: 'compile', label: '编译',     status: 'pending' },
  { key: 'push',    label: '推送更新', status: 'pending' },
  { key: 'done',    label: '完成',     status: 'pending' },
]

// ── Store interface ───────────────────────────────────────────────────────────

interface ModificationStore {
  sessionId: string | null
  appId: string | null
  appName: string | null
  userIntent: string
  /** Overall flow status */
  planStatus: 'idle' | 'planning' | 'ready' | 'applying' | 'done' | 'error'
  modifySession: ModifySession | null
  updateProgress: UpdateStage[]
  error: string | null
  /** Structured error with a machine-readable code */
  structuredError: { code: string; message: string } | null
  /** Pending rollback notification */
  rollbackNotification: { appId: string; timestamp: number } | null

  // ── internal setters (used by ModificationWindow useEffect) ──────────────
  setSessionId: (id: string) => void
  appendPlanChunk: (text: string) => void
  setPlanSession: (session: ModifySession) => void
  setPlanError: (message: string) => void
  setProgressStage: (key: UpdateStageKey, status: UpdateStage['status'], errorMessage?: string) => void

  // ── public actions ────────────────────────────────────────────────────────
  setUserIntent: (intent: string) => void
  setError: (error: { code: string; message: string } | null) => void
  showRollbackNotification: (appId: string) => void
  clearRollbackNotification: () => void
  startPlanning: (appId: string, appName: string, intent: string) => Promise<void>
  confirmAndApply: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState = {
  sessionId: null as string | null,
  appId: null as string | null,
  appName: null as string | null,
  userIntent: '',
  planStatus: 'idle' as const,
  modifySession: null as ModifySession | null,
  updateProgress: DEFAULT_STAGES.map((s) => ({ ...s })),
  error: null as string | null,
  structuredError: null as { code: string; message: string } | null,
  rollbackNotification: null as { appId: string; timestamp: number } | null,
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useModificationStore = create<ModificationStore>((set, get) => ({
  ...initialState,

  // ── internal setters ──────────────────────────────────────────────────────

  setSessionId: (id) => set({ sessionId: id }),

  appendPlanChunk: (_text) => {
    // Plan arrives as a single completed session object via setPlanSession.
    // This hook exists for raw text streaming if needed in the future.
  },

  setPlanSession: (session) =>
    set({ modifySession: session, planStatus: 'ready' }),

  setPlanError: (message) =>
    set({ planStatus: 'error', error: message, structuredError: { code: 'PLAN_ERROR', message } }),

  setProgressStage: (key, status, errorMessage) =>
    set((s) => ({
      updateProgress: s.updateProgress.map((stage): UpdateStage => {
        if (stage.key !== key) return stage
        const next: UpdateStage = { ...stage, status }
        if (errorMessage !== undefined) next.errorMessage = errorMessage
        return next
      }),
    })),

  // ── public actions ────────────────────────────────────────────────────────

  setUserIntent: (intent) => set({ userIntent: intent }),

  setError: (error) => set({ structuredError: error }),

  showRollbackNotification: (appId) =>
    set({ rollbackNotification: { appId, timestamp: Date.now() } }),

  clearRollbackNotification: () => set({ rollbackNotification: null }),

  startPlanning: async (appId, appName, intent) => {
    set({
      appId,
      appName,
      userIntent: intent,
      planStatus: 'planning',
      modifySession: null,
      error: null,
      structuredError: null,
      sessionId: null,
    })
    try {
      const modification = (window.intentOS as unknown as IntentOSWithModification).modification
      const result = await modification.start(appId, intent)
      const sessionId: string = (result as { sessionId: string }).sessionId
      set({ sessionId })
      // Streaming events arrive via ModificationWindow useEffect subscription.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ planStatus: 'error', error: message })
      throw err
    }
  },

  confirmAndApply: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    set({
      planStatus: 'applying',
      updateProgress: DEFAULT_STAGES.map((s) => ({ ...s })),
      error: null,
      structuredError: null,
    })
    try {
      const modification = (window.intentOS as unknown as IntentOSWithModification).modification
      await modification.confirm(sessionId)
      // Progress updates flow in via ModificationWindow useEffect.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ planStatus: 'error', error: message })
      throw err
    }
  },

  cancel: async () => {
    const { sessionId } = get()
    if (!sessionId) return
    try {
      const modification = (window.intentOS as unknown as IntentOSWithModification).modification
      await modification.cancel(sessionId)
    } catch {
      // best-effort
    }
    get().reset()
  },

  reset: () =>
    set({ ...initialState, updateProgress: DEFAULT_STAGES.map((s) => ({ ...s })) }),
}))

// ── Augmented window type ─────────────────────────────────────────────────────
// The modification API is not yet in global.d.ts; cast locally.

interface ModificationAPIShape {
  start(appId: string, requirement: string): Promise<{ sessionId: string; status: string }>
  confirm(sessionId: string): Promise<{ appId: string; status: string }>
  cancel(sessionId: string): Promise<{ success: boolean }>
  onPlanChunk(sessionId: string, cb: (chunk: ModificationPlanChunk) => void): () => void
  onProgress(sessionId: string, cb: (progress: ModificationProgress) => void): () => void
  onError(sessionId: string, cb: (error: { code: string; message: string }) => void): () => void
}

export interface ModificationPlanChunk {
  sessionId: string
  phase: 'planning' | 'complete' | 'error'
  content: string
  /** Present when phase === 'complete' */
  modifySession?: ModifySession
}

export interface ModificationProgress {
  sessionId: string
  stage: UpdateStageKey
  status: 'active' | 'done' | 'error'
  message?: string
}

export interface IntentOSWithModification {
  modification: ModificationAPIShape
}
