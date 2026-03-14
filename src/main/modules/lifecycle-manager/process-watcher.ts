/**
 * M-03 LifecycleManager — ProcessWatcher
 *
 * Monitors a spawned ChildProcess and delegates crash handling to LifecycleManager.
 * Does NOT start or stop processes — that responsibility belongs to LifecycleManager.
 */

import type { ChildProcess } from 'child_process'
import type { ICrashNotification } from './types'

// Forward-declare the interface that LifecycleManager satisfies, to avoid a
// circular-import between this file and lifecycle-manager.ts.
interface ILifecycleManagerForWatcher {
  handleCrash(appId: string, info: ICrashNotification): Promise<void>
  isStopRequested(appId: string): boolean
}

// ── ProcessWatcher ────────────────────────────────────────────────────────────

export class ProcessWatcher {
  constructor(private readonly lifecycleManager: ILifecycleManagerForWatcher) {}

  /**
   * Attach exit/error listeners to a freshly spawned child process.
   * Called by LifecycleManager immediately after spawn().
   */
  watchProcess(child: ChildProcess, appId: string): void {
    let monitoring = true

    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (!monitoring) return
      monitoring = false

      // Distinguish: user-requested stop vs unexpected exit
      const isUserStop = this.lifecycleManager.isStopRequested(appId)

      // Abnormal = non-zero exit code OR terminated by a signal
      const isAbnormal = code !== 0 || signal !== null

      if (isAbnormal && !isUserStop) {
        void this.handleCrash(appId, code, signal ? String(signal) : null)
      }
    })

    child.once('error', (_err: Error) => {
      if (!monitoring) return
      monitoring = false

      void this.handleCrash(appId, -1, 'error')
    })
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async handleCrash(
    appId: string,
    exitCode: number | null,
    signal: string | null
  ): Promise<void> {
    const info: ICrashNotification = {
      appId,
      exitCode:  exitCode  ?? -1,
      signal:    signal    ?? 'unknown',
      timestamp: Date.now(),
    }
    await this.lifecycleManager.handleCrash(appId, info)
  }
}
