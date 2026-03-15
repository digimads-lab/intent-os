/**
 * Generation IPC handlers
 *
 * Registers ipcHub.handle() for all generation:* channels.
 * Channel names match exactly what preload uses via ipcRenderer.invoke().
 *
 * All responses are wrapped in { success: true, data } | { success: false, error, code }.
 *
 * generation:confirm-generate is a long-running async operation.
 * The handler fires-and-forgets — actual progress is pushed via
 * ai-provider:gen-progress:{sessionId} and ai-provider:gen-complete:{sessionId}.
 */

import { randomUUID } from 'crypto'

import type { BrowserWindow } from 'electron'

import { ipcHub } from '../ipc-hub'
import { lifecycleManager } from '../modules/lifecycle-manager'
import type { AIProviderManager } from '../modules/ai-provider'
import type { SkillManager } from '../modules/skill-manager'
import { PlanSessionManager } from '../modules/generator/plan-session'
import { GenerateSessionManager } from '../modules/generator/generate-session'

// ── Module-level singletons ────────────────────────────────────────────────────

let planSessionManager: PlanSessionManager | null = null
let generateSessionManager: GenerateSessionManager | null = null

// ── Handler registration ───────────────────────────────────────────────────────

export function registerGenerationHandlers(
  mainWindow: BrowserWindow,
  providerManager: AIProviderManager,
  skillManager: SkillManager,
): void {
  const getWindowSender = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    return mainWindow.webContents
  }

  // Lazily create singletons on first registration so that mainWindow and
  // managers are fully initialised before use.
  if (planSessionManager === null) {
    planSessionManager = new PlanSessionManager(providerManager, skillManager, getWindowSender)
    generateSessionManager = new GenerateSessionManager(
      providerManager,
      planSessionManager,
      lifecycleManager,
    )
  }

  const psm = planSessionManager
  const gsm = generateSessionManager!

  // generation:start-plan — register session immediately, stream in background
  // Returns sessionId synchronously so the renderer can subscribe to plan-chunk events
  // before the first chunk arrives.
  ipcHub.register('generation:start-plan', (event, { skillIds, intent }: { skillIds: string[]; intent: string }) => {
    try {
      const sessionId = randomUUID()
      psm.beginPlanSession(sessionId, { skillIds, intent }, event.sender)
      return { success: true, data: { sessionId } }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // generation:refine-plan — append user feedback and continue planning
  ipcHub.register('generation:refine-plan', async (_event, { sessionId, feedback }: { sessionId: string; feedback: string }) => {
    try {
      await psm.refinePlan(sessionId, feedback)
      return { success: true, data: { status: 'streaming' } }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // generation:confirm-generate — fire-and-forget: returns immediately while
  // progress is pushed via ai-provider:gen-progress:{sessionId} IPC push events.
  ipcHub.register('generation:confirm-generate', async (event, { sessionId, appName }: { sessionId: string; appName?: string }) => {
    try {
      const name = appName ?? 'my-app'
      // Intentionally not awaited — progress is streamed via IPC push events.
      gsm.confirmAndGenerate(sessionId, name, event.sender).catch(() => {
        // Errors are already forwarded to the renderer via ai-provider:gen-error:{sessionId}
        // in GenerateSessionManager.confirmAndGenerate().
      })
      return { success: true, data: { status: 'code-generating' } }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // generation:cancel — cancel an active planning or generation session
  ipcHub.register('generation:cancel', async (_event, { sessionId }: { sessionId: string }) => {
    try {
      psm.cancelPlanSession(sessionId)
      return { success: true, data: { success: true } }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })
}
