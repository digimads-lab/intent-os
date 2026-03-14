/**
 * BackupManager — creates, restores, lists and deletes per-app backups.
 *
 * Backup layout:
 *   {appDir}/backup/{timestamp}-{uuid}/   ← one folder per backup
 *     (mirrors the original src/ tree)
 *
 * Max 5 backups retained per app; oldest are pruned automatically.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BackupEntry {
  backupId: string
  appId: string
  backupDir: string
  createdAt: Date
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BACKUPS = 5

// ── Helpers ───────────────────────────────────────────────────────────────────

function backupRootDir(appDir: string): string {
  return path.join(appDir, 'backup')
}

/**
 * Recursively copy all files from `src` into `dest`, preserving sub-directory
 * structure.  Both directories must exist before calling.
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath  = path.join(src,  entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await fsp.mkdir(destPath, { recursive: true })
      await copyDirRecursive(srcPath, destPath)
    } else {
      await fsp.copyFile(srcPath, destPath)
    }
  }
}

// ── BackupManager ─────────────────────────────────────────────────────────────

export class BackupManager {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Create a backup of `{appDir}/src/` inside `{appDir}/backup/{backupId}/`.
   * Returns the generated backupId (timestamp-uuid string).
   * Auto-prunes oldest backups when the per-app limit is exceeded.
   */
  async createBackup(appId: string, appDir: string): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '')

    const backupId  = `${timestamp}-${randomUUID()}`
    const backupDir = path.join(backupRootDir(appDir), backupId)

    await fsp.mkdir(backupDir, { recursive: true })

    const srcDir = path.join(appDir, 'src')
    if (fs.existsSync(srcDir)) {
      await copyDirRecursive(srcDir, backupDir)
    }

    // Prune oldest backups if over limit
    await this.pruneBackups(appId, appDir)

    return backupId
  }

  /**
   * Restore a backup identified by `backupId` back into `{appDir}/src/`.
   * The existing `src/` directory is replaced with the backup contents.
   */
  async restoreBackup(appId: string, backupId: string, appDir: string): Promise<void> {
    const backupDir = path.join(backupRootDir(appDir), backupId)

    if (!fs.existsSync(backupDir)) {
      throw new Error(
        `[BackupManager] Backup not found: appId=${appId} backupId=${backupId}`
      )
    }

    const srcDir = path.join(appDir, 'src')

    // Remove current src directory and recreate it
    if (fs.existsSync(srcDir)) {
      await fsp.rm(srcDir, { recursive: true, force: true })
    }
    await fsp.mkdir(srcDir, { recursive: true })

    await copyDirRecursive(backupDir, srcDir)
  }

  /**
   * List all backups for an app, sorted newest-first.
   */
  async listBackups(appId: string, appDir: string): Promise<BackupEntry[]> {
    const rootDir = backupRootDir(appDir)

    if (!fs.existsSync(rootDir)) {
      return []
    }

    const entries = await fsp.readdir(rootDir, { withFileTypes: true })
    const backups: BackupEntry[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const backupDir = path.join(rootDir, entry.name)
      let stat: fs.Stats
      try {
        stat = await fsp.stat(backupDir)
      } catch {
        continue
      }

      backups.push({
        backupId:  entry.name,
        appId,
        backupDir,
        createdAt: stat.birthtime,
      })
    }

    // Newest first
    backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return backups
  }

  /**
   * Delete a specific backup by backupId.
   */
  async deleteBackup(appId: string, backupId: string, appDir: string): Promise<void> {
    const backupDir = path.join(backupRootDir(appDir), backupId)

    if (!fs.existsSync(backupDir)) {
      console.warn(
        `[BackupManager] deleteBackup: not found appId=${appId} backupId=${backupId}`
      )
      return
    }

    await fsp.rm(backupDir, { recursive: true, force: true })
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Remove oldest backups so that no more than MAX_BACKUPS remain.
   */
  private async pruneBackups(appId: string, appDir: string): Promise<void> {
    const backups = await this.listBackups(appId, appDir)

    if (backups.length <= MAX_BACKUPS) return

    const toDelete = backups.slice(MAX_BACKUPS)
    for (const backup of toDelete) {
      try {
        await fsp.rm(backup.backupDir, { recursive: true, force: true })
      } catch (err) {
        console.warn(
          `[BackupManager] Failed to prune backup ${backup.backupId}:`,
          err
        )
      }
    }
  }
}
