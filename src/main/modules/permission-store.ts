/**
 * PermissionStore — persistent permission record for SkillApps
 *
 * Stores per-app permission decisions (granted/denied) to disk so that
 * users are not re-prompted after an app restart.
 *
 * Storage format:
 *   {userDataPath}/permissions.json
 *   Record<appId, Record<"resource:level", "granted" | "denied">>
 *
 * All reads and writes are synchronous to keep the permission check path
 * simple and free of async edge-cases during IPC handler dispatch.
 */

import * as fs from 'fs'
import * as path from 'path'

type PermissionStatus = 'granted' | 'denied'
type PermissionMap = Record<string, Record<string, PermissionStatus>>

export class PermissionStore {
  private readonly filePath: string
  private cache: PermissionMap

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'permissions.json')
    this.cache = this.load()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns true if there is an explicit 'granted' record for the given
   * appId / resource / level triple.
   */
  hasPermission(appId: string, resource: string, level: string): boolean {
    return this.getPermission(appId, resource, level) === 'granted'
  }

  /**
   * Persist a 'granted' decision for the given triple.
   */
  grantPermission(appId: string, resource: string, level: string): void {
    this.set(appId, resource, level, 'granted')
  }

  /**
   * Persist a 'denied' decision for the given triple.
   */
  denyPermission(appId: string, resource: string, level: string): void {
    this.set(appId, resource, level, 'denied')
  }

  /**
   * Returns 'granted', 'denied', or 'unknown' for the given triple.
   */
  getPermission(
    appId: string,
    resource: string,
    level: string
  ): PermissionStatus | 'unknown' {
    const appRecord = this.cache[appId]
    if (!appRecord) return 'unknown'
    const key = `${resource}:${level}`
    return appRecord[key] ?? 'unknown'
  }

  /**
   * Remove all permission records for a SkillApp (called on uninstall).
   */
  revokeAppPermissions(appId: string): void {
    if (!this.cache[appId]) return
    delete this.cache[appId]
    this.save()
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private set(
    appId: string,
    resource: string,
    level: string,
    status: PermissionStatus
  ): void {
    if (!this.cache[appId]) {
      this.cache[appId] = {}
    }
    this.cache[appId][`${resource}:${level}`] = status
    this.save()
  }

  private load(): PermissionMap {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as PermissionMap
      }
    } catch {
      // File doesn't exist or is malformed — start with empty map
    }
    return {}
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8')
    } catch (err) {
      console.error('[PermissionStore] Failed to save permissions.json:', err)
    }
  }
}
