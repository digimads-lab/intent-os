/**
 * HotUpdater — Desktop-side hot update engine.
 *
 * Applies an incoming HotUpdatePackage to a running SkillApp:
 *   1. Backup src/ via BackupManager (atomic: BEFORE any writes)
 *   2. Write new/modified files to {appDir}/src/app/
 *   3. Run incremental tsc compilation
 *   4. Push runtime:hotUpdate notification to SkillApp via SocketServer
 *   5. Wait up to 10 s for SkillApp acknowledgement (status.report running/ready)
 *   6. On success: clean up older backups (keep last 2)
 *   7. On failure (compile error or ack timeout): reload webContents; throw
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { BrowserWindow, webContents } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { hotUpdateAckBus } from './ack-bus'

import { BackupManager } from './backup-manager'

// ── Local type mirror of HotUpdatePackage from @intentos/skillapp-runtime ─────
// Defined locally to avoid a cross-package tsconfig include.
// Must stay in sync with packages/skillapp-runtime/src/types.ts.

interface ModuleUpdate {
  path: string
  action: 'add' | 'modify' | 'delete'
  content?: string           // base64 encoded
  compiledContent?: string   // base64 encoded
}

interface ManifestDelta {
  addedSkills?: string[]
  removedSkills?: string[]
  addedPermissions?: PermissionEntry[]
  removedPermissions?: PermissionEntry[]
}

interface PermissionEntry {
  resourceType: 'fs' | 'net' | 'process'
  resourcePath: string
  action: 'read' | 'write' | 'execute' | 'connect'
  grantedAt: string
  persistent: boolean
}

export interface HotUpdatePackage {
  appId: string
  fromVersion: string
  toVersion: string
  timestamp: number
  modules: ModuleUpdate[]
  manifest: ManifestDelta
  checksum: string   // SHA-256 hex
}
import { socketServer } from '../socket-server/socket-server'

const execFileAsync = promisify(execFile)

// ── Constants ──────────────────────────────────────────────────────────────────

/** JSON-RPC notification method name the SkillApp runtime listens on */
const RUNTIME_HOT_UPDATE_METHOD = 'hotUpdate'

/** Milliseconds to wait for SkillApp ack after pushing the notification */
const ACK_TIMEOUT_MS = 10_000

/** Number of recent backups to retain after a successful update */
const BACKUPS_TO_KEEP = 2

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Find any BrowserWindow associated with the given SkillApp.
 * Used only as a last-resort reload trigger.
 */
function findSkillAppWindow(appId: string): BrowserWindow | null {
  // Prefer a window whose URL contains the appId
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getURL().includes(appId)) {
      return BrowserWindow.fromWebContents(wc)
    }
  }

  // Fallback: any non-destroyed window
  for (const wc of webContents.getAllWebContents()) {
    const win = BrowserWindow.fromWebContents(wc)
    if (win && !win.isDestroyed()) {
      return win
    }
  }

  return null
}

// ── HotUpdater ─────────────────────────────────────────────────────────────────

export class HotUpdater {
  private readonly backupManager: BackupManager

  /** Tracks the most recent backupId per appId, for rollback-handler use */
  private readonly lastBackupIds = new Map<string, string>()

  constructor() {
    this.backupManager = new BackupManager()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply a hot update package to the running SkillApp.
   *
   * @param appId         Target SkillApp identifier
   * @param updatePackage The update package produced by M-05
   * @param appDir        Absolute path to the SkillApp output directory
   */
  async applyHotUpdate(
    appId: string,
    updatePackage: HotUpdatePackage,
    appDir: string,
  ): Promise<void> {
    // ── Step 1: Create backup BEFORE any file writes ─────────────────────────
    let backupId: string
    try {
      backupId = await this.backupManager.createBackup(appId, appDir)
      this.lastBackupIds.set(appId, backupId)
    } catch (err) {
      const msg = `[HotUpdater] Backup creation failed for appId=${appId}: ${(err as Error).message}`
      console.error(msg)
      throw new Error(msg)
    }

    try {
      // ── Step 2: Write new/modified files to {appDir}/src/app/ ─────────────
      await this.writeModuleFiles(appId, appDir, updatePackage)

      // ── Step 3: Run incremental tsc compilation ────────────────────────────
      await this.runTscCompilation(appDir)

      // ── Step 4 + 5: Push notification and wait for ack ────────────────────
      await this.pushUpdateAndWaitForAck(appId, updatePackage)

    } catch (err) {
      // ── Step 7: Failure path — reload webContents as fallback, then throw ──
      const errMsg = (err as Error).message
      console.error(`[HotUpdater] Hot update failed for appId=${appId}: ${errMsg}`)
      this.triggerWebContentsReload(appId)
      throw err
    }

    // ── Step 6: Success — prune old backups ───────────────────────────────────
    await this.pruneOldBackups(appId, appDir, backupId)
  }

  /**
   * Return the most recent backupId for an appId.
   * Used by the rollback-handler to know which backup to restore.
   */
  getLastBackupId(appId: string): string | undefined {
    return this.lastBackupIds.get(appId)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Write all add/modify module files from the package into {appDir}/src/app/.
   * Files with action === 'delete' are removed.
   */
  private async writeModuleFiles(
    appId: string,
    appDir: string,
    pkg: HotUpdatePackage,
  ): Promise<void> {
    for (const mod of pkg.modules) {
      const filePath = path.join(appDir, 'src', 'app', mod.path)

      if (mod.action === 'delete') {
        try {
          await fsp.unlink(filePath)
        } catch (err) {
          console.warn(
            `[HotUpdater] Could not delete ${filePath} for appId=${appId}: ${(err as Error).message}`,
          )
        }
        continue
      }

      // add or modify — content required
      if (!mod.content) {
        throw new Error(
          `[HotUpdater] Module '${mod.path}' (action=${mod.action}) is missing content for appId=${appId}`,
        )
      }

      const dir = path.dirname(filePath)
      await fsp.mkdir(dir, { recursive: true })

      // content field is base64 encoded per HotUpdatePackage type definition
      const buffer = Buffer.from(mod.content, 'base64')
      await fsp.writeFile(filePath, buffer)
    }
  }

  /**
   * Run `tsc --incremental` inside the SkillApp directory.
   * Throws with compiler output if the exit code is non-zero.
   */
  private async runTscCompilation(appDir: string): Promise<void> {
    const tscBin = path.join(appDir, 'node_modules', '.bin', 'tsc')

    try {
      await execFileAsync(tscBin, ['--incremental'], {
        cwd: appDir,
        timeout: 60_000,
      })
    } catch (err) {
      const spawnErr = err as { stdout?: string; stderr?: string; message: string }
      const detail   = spawnErr.stderr ?? spawnErr.stdout ?? spawnErr.message
      throw new Error(`[HotUpdater] tsc compilation failed:\n${detail}`)
    }
  }

  /**
   * Push the hotUpdate JSON-RPC notification to the SkillApp via SocketServer
   * then wait up to ACK_TIMEOUT_MS for the SkillApp's status.report reply.
   *
   * The SkillApp runtime is expected to call status.report with status='running'
   * or status='ready' after a successful update, or status='hot_update_failed'
   * on failure.  The M-03/M-06 handler that processes status.report should
   * emit on hotUpdateAckBus so we can detect it here.
   *
   * If no ack arrives within ACK_TIMEOUT_MS the promise rejects (triggering
   * the fallback reload).
   */
  private pushUpdateAndWaitForAck(
    appId: string,
    pkg: HotUpdatePackage,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        hotUpdateAckBus.off('status', onStatus)
        reject(
          new Error(
            `[HotUpdater] Ack timeout (${ACK_TIMEOUT_MS} ms) waiting for appId=${appId}`,
          ),
        )
      }, ACK_TIMEOUT_MS)

      const onStatus = (eventAppId: string, status: string): void => {
        if (eventAppId !== appId) return
        if (settled) return
        settled = true
        clearTimeout(timer)
        hotUpdateAckBus.off('status', onStatus)

        if (status === 'running' || status === 'ready') {
          resolve()
        } else {
          reject(
            new Error(
              `[HotUpdater] SkillApp reported status='${status}' after hot update for appId=${appId}`,
            ),
          )
        }
      }

      hotUpdateAckBus.on('status', onStatus)

      // Send the notification AFTER registering the listener to avoid a race
      socketServer.sendToApp(appId, RUNTIME_HOT_UPDATE_METHOD, {
        appId:       pkg.appId,
        fromVersion: pkg.fromVersion,
        toVersion:   pkg.toVersion,
        timestamp:   pkg.timestamp,
        modules:     pkg.modules as unknown as Record<string, unknown>[],
        manifest:    pkg.manifest as unknown as Record<string, unknown>,
        checksum:    pkg.checksum,
      })
    })
  }

  /**
   * Trigger a full page reload on the SkillApp's BrowserWindow.
   * Used as the fallback when tsc fails or the ack times out.
   */
  private triggerWebContentsReload(appId: string): void {
    const win = findSkillAppWindow(appId)
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.reloadIgnoringCache()
      } catch (err) {
        console.warn(
          `[HotUpdater] reloadIgnoringCache() failed for appId=${appId}:`,
          err,
        )
      }
    } else {
      console.warn(
        `[HotUpdater] No BrowserWindow found for appId=${appId} — cannot trigger reload`,
      )
    }
  }

  /**
   * Prune old backups after a successful update.
   * Retains the current backup plus up to (BACKUPS_TO_KEEP - 1) older ones.
   */
  private async pruneOldBackups(
    appId: string,
    appDir: string,
    currentBackupId: string,
  ): Promise<void> {
    try {
      const backups = await this.backupManager.listBackups(appId, appDir)

      // Separate current from previous backups (list is newest-first)
      const others  = backups.filter(b => b.backupId !== currentBackupId)
      const toKeep  = BACKUPS_TO_KEEP - 1  // current counts as one kept backup
      const toDelete = others.slice(toKeep)

      for (const backup of toDelete) {
        await this.backupManager.deleteBackup(appId, backup.backupId, appDir)
      }
    } catch (err) {
      console.warn(`[HotUpdater] Backup pruning failed for appId=${appId}:`, err)
    }
  }
}
