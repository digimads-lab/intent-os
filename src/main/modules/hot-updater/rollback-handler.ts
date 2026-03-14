/**
 * RollbackHandler — auto-rollback on SkillApp crash after a hot update.
 *
 * When a SkillApp crashes AND it has a pending backup (was recently hot-updated),
 * this handler:
 *   1. Restores the backup via BackupManager
 *   2. Restarts the SkillApp via LifecycleManager.launchApp()
 *   3. Notifies the Desktop window
 */

import { BrowserWindow } from 'electron'

import { BackupManager } from './backup-manager'
import type { HotUpdater } from './hot-updater'
import type { LifecycleManager } from '../lifecycle-manager/lifecycle-manager'
import type { AppStatusEvent } from '../lifecycle-manager/types'

// ── RollbackHandler ────────────────────────────────────────────────────────────

export class RollbackHandler {
  private readonly backupManager: BackupManager
  private readonly lifecycleManager: LifecycleManager
  private readonly hotUpdater: HotUpdater
  private readonly mainWindow: BrowserWindow | null
  private unsubscribe: (() => void) | null = null

  constructor(
    backupManager: BackupManager,
    lifecycleManager: LifecycleManager,
    hotUpdater: HotUpdater,
    mainWindow?: BrowserWindow,
  ) {
    this.backupManager     = backupManager
    this.lifecycleManager  = lifecycleManager
    this.hotUpdater        = hotUpdater
    this.mainWindow        = mainWindow ?? null
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to lifecycle crash events.
   * Call once during app startup.
   */
  initialize(): void {
    if (this.unsubscribe) return   // already initialized

    this.unsubscribe = this.lifecycleManager.onAppStatusChanged(
      (event: AppStatusEvent) => { void this.onStatusChanged(event) }
    )
  }

  /**
   * Unsubscribe from lifecycle events.
   * Call during app shutdown.
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async onStatusChanged(event: AppStatusEvent): Promise<void> {
    if (event.status !== 'crashed') return

    const { appId } = event

    // Only roll back if a hot update was recently applied for this app
    const backupId = this.hotUpdater.getLastBackupId(appId)
    if (!backupId) return

    console.log(
      `[RollbackHandler] Crash detected after hot update for appId=${appId}, ` +
      `backupId=${backupId}. Starting rollback.`
    )

    try {
      // Step 1: Resolve outputDir from the registry
      const apps   = await this.lifecycleManager.listApps()
      const appMeta = apps.find(a => a.id === appId)
      if (!appMeta) {
        console.error(`[RollbackHandler] App not found in registry: appId=${appId}`)
        return
      }

      // Step 2: Restore backup files
      await this.backupManager.restoreBackup(appId, backupId, appMeta.outputDir)
      console.log(`[RollbackHandler] Backup restored for appId=${appId}`)

      // Step 3: Restart the SkillApp
      await this.lifecycleManager.launchApp(appId)
      console.log(`[RollbackHandler] SkillApp restarted after rollback for appId=${appId}`)

      // Step 4: Notify Desktop
      this.notifyDesktop()

    } catch (err) {
      console.error(
        `[RollbackHandler] Rollback failed for appId=${appId}: ${(err as Error).message}`
      )
    }
  }

  private notifyDesktop(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    try {
      this.mainWindow.webContents.send('notification:show', {
        type:    'warning',
        message: '已回滚到上一版本',
      })
    } catch (err) {
      console.warn(
        `[RollbackHandler] Failed to send notification to Desktop: ${(err as Error).message}`
      )
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createRollbackHandler(
  backupManager: BackupManager,
  lifecycleManager: LifecycleManager,
  hotUpdater: HotUpdater,
  mainWindow?: BrowserWindow,
): RollbackHandler {
  return new RollbackHandler(backupManager, lifecycleManager, hotUpdater, mainWindow)
}
