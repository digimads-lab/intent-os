/**
 * Modification IPC handlers
 *
 * Registers ipcHub.handle() for all modification:* channels.
 * Channel names match exactly what the preload script exposes via ipcRenderer.invoke().
 *
 * modification:start-plan  — fire-and-forget planning (streams modification:plan-chunk events)
 * modification:confirm     — fire-and-forget code gen + hot update (streams modification:progress)
 * modification:cancel      — cancel an active modification session
 */

import type { BrowserWindow } from 'electron'

import { ipcHub } from '../ipc-hub'
import { lifecycleManager } from '../modules/lifecycle-manager'
import { hotUpdater } from '../modules/hot-updater'
import type { AIProviderManager } from '../modules/ai-provider'
import { ModifySessionManager } from '../modules/generator/modify-session'
import { confirmAndApplyModify } from '../modules/generator/modify-generate'

// ── Module-level singletons ────────────────────────────────────────────────────

let modifySessionManager: ModifySessionManager | null = null

// ── Handler registration ───────────────────────────────────────────────────────

export function registerModificationHandlers(
  _mainWindow: BrowserWindow,
  providerManager: AIProviderManager,
): void {
  if (modifySessionManager === null) {
    const provider = providerManager.getProvider()
    if (provider === null) {
      throw new Error('registerModificationHandlers: AIProvider not yet set on providerManager')
    }
    modifySessionManager = new ModifySessionManager(
      provider,
      async (appId: string): Promise<string> => {
        const apps = await lifecycleManager.listApps()
        const found = apps.find((a) => a.id === appId)
        if (!found) throw new Error(`APP_DIR_NOT_FOUND: no registered app with id '${appId}'`)
        return found.outputDir
      },
    )
  }

  const msm = modifySessionManager

  // modification:start-plan — returns sessionId immediately; plan streams in background
  ipcHub.register(
    'modification:start-plan',
    async (event, { appId, requirement }: { appId: string; requirement: string }) => {
      try {
        const { sessionId } = await msm.startModifySession(appId, requirement, event.sender)
        return { success: true, data: { sessionId } }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  // modification:confirm — fire-and-forget code gen + hot update
  // appId is resolved from the session (not passed by client) to avoid N-05 mismatch.
  ipcHub.register(
    'modification:confirm',
    async (event, { sessionId }: { sessionId: string }) => {
      try {
        const provider = providerManager.getProvider()
        if (provider === null) {
          return { success: false, error: 'AI Provider not configured', code: 'NO_PROVIDER' }
        }
        const appId = msm.getSessionAppId(sessionId)
        if (!appId) {
          return { success: false, error: 'Session not found or expired', code: 'SESSION_NOT_FOUND' }
        }
        // Intentionally not awaited — progress streamed via modification:progress push events.
        confirmAndApplyModify(
          sessionId,
          appId,
          event.sender,
          msm,
          provider,
          lifecycleManager,
          hotUpdater,
        ).catch(() => {
          // Errors are forwarded to the renderer via modification:error in confirmAndApplyModify
        })
        return { success: true, data: { status: 'applying' } }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  // modification:cancel — cancel an active modification session
  ipcHub.register(
    'modification:cancel',
    async (_event, { sessionId }: { sessionId: string }) => {
      try {
        msm.cancelModifySession(sessionId)
        return { success: true, data: { success: true } }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )
}
