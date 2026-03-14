/**
 * M-03 LifecycleManager — SQLite data-access layer (AppRegistry)
 */

import Database from 'better-sqlite3'
import type { AppStatus } from './app-status'
import type { AppMeta, AppRow, WindowBounds } from './types'

// ── Schema DDL ────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS apps (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    description          TEXT,
    version              INTEGER DEFAULT 1,

    skillIds             TEXT NOT NULL,

    status               TEXT NOT NULL DEFAULT 'registered',

    outputDir            TEXT NOT NULL UNIQUE,
    entryPoint           TEXT NOT NULL,
    pid                  INTEGER,

    windowBounds         TEXT,
    windowBoundsSaved    TEXT,

    crashCount           INTEGER DEFAULT 0,
    lastCrashAt          TEXT,
    lastRestartAt        TEXT,
    stableRunningSeconds INTEGER,

    createdAt            TEXT NOT NULL,
    updatedAt            TEXT NOT NULL,

    permissions          TEXT,
    environment          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_apps_status    ON apps(status);
  CREATE INDEX IF NOT EXISTS idx_apps_pid       ON apps(pid);
  CREATE INDEX IF NOT EXISTS idx_apps_createdAt ON apps(createdAt);
`

// ── AppRegistry ───────────────────────────────────────────────────────────────

export class AppRegistry {
  private readonly db: Database.Database

  // Prepared statements
  private readonly stmtGetApp:              Database.Statement
  private readonly stmtInsertApp:           Database.Statement
  private readonly stmtUpdateStatus:        Database.Statement
  private readonly stmtUpdatePid:           Database.Statement
  private readonly stmtIncrementCrash:      Database.Statement
  private readonly stmtResetCrash:          Database.Statement
  private readonly stmtSaveWindowBounds:    Database.Statement
  private readonly stmtListApps:            Database.Statement
  private readonly stmtDeleteApp:           Database.Statement
  private readonly stmtRestoreOnStartup:    Database.Statement

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA_SQL)

    this.stmtGetApp = this.db.prepare(
      'SELECT * FROM apps WHERE id = ?'
    )

    this.stmtInsertApp = this.db.prepare(`
      INSERT INTO apps
        (id, name, description, version, skillIds, status,
         outputDir, entryPoint, pid,
         windowBounds, windowBoundsSaved,
         crashCount, lastCrashAt, lastRestartAt, stableRunningSeconds,
         createdAt, updatedAt, permissions, environment)
      VALUES
        (@id, @name, @description, @version, @skillIds, @status,
         @outputDir, @entryPoint, @pid,
         @windowBounds, @windowBoundsSaved,
         @crashCount, @lastCrashAt, @lastRestartAt, @stableRunningSeconds,
         @createdAt, @updatedAt, @permissions, @environment)
    `)

    this.stmtUpdateStatus = this.db.prepare(`
      UPDATE apps
      SET status = @status, updatedAt = @updatedAt
      WHERE id = @id
    `)

    this.stmtUpdatePid = this.db.prepare(`
      UPDATE apps
      SET pid = @pid, updatedAt = @updatedAt
      WHERE id = @id
    `)

    this.stmtIncrementCrash = this.db.prepare(`
      UPDATE apps
      SET crashCount = crashCount + 1,
          lastCrashAt = @lastCrashAt,
          status = 'crashed',
          updatedAt = @updatedAt
      WHERE id = @id
    `)

    this.stmtResetCrash = this.db.prepare(`
      UPDATE apps
      SET crashCount = 0, updatedAt = @updatedAt
      WHERE id = @id
    `)

    this.stmtSaveWindowBounds = this.db.prepare(`
      UPDATE apps
      SET windowBounds = @windowBounds,
          windowBoundsSaved = @windowBounds,
          updatedAt = @updatedAt
      WHERE id = @id
    `)

    this.stmtListApps = this.db.prepare(
      'SELECT * FROM apps ORDER BY createdAt DESC'
    )

    this.stmtDeleteApp = this.db.prepare(
      'DELETE FROM apps WHERE id = ?'
    )

    // Reset in-progress states that won't survive a Desktop restart
    this.stmtRestoreOnStartup = this.db.prepare(`
      UPDATE apps
      SET status = 'stopped', pid = NULL, updatedAt = ?
      WHERE status IN ('running', 'restarting', 'starting')
    `)
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getApp(appId: string): AppRow | undefined {
    return this.stmtGetApp.get(appId) as AppRow | undefined
  }

  insertApp(meta: AppMeta): void {
    this.stmtInsertApp.run({
      id:                   meta.id,
      name:                 meta.name,
      description:          meta.description ?? null,
      version:              meta.version,
      skillIds:             JSON.stringify(meta.skillIds),
      status:               meta.status,
      outputDir:            meta.outputDir,
      entryPoint:           meta.entryPoint,
      pid:                  meta.pid ?? null,
      windowBounds:         meta.windowBounds ? JSON.stringify(meta.windowBounds) : null,
      windowBoundsSaved:    null,
      crashCount:           meta.crashCount,
      lastCrashAt:          meta.lastCrashAt ?? null,
      lastRestartAt:        null,
      stableRunningSeconds: null,
      createdAt:            meta.createdAt,
      updatedAt:            meta.updatedAt,
      permissions:          null,
      environment:          null,
    })
  }

  updateStatus(
    appId: string,
    status: AppStatus,
    extra?: { pid?: number | null }
  ): void {
    const now = new Date().toISOString()
    this.stmtUpdateStatus.run({ id: appId, status, updatedAt: now })
    if (extra?.pid !== undefined) {
      this.stmtUpdatePid.run({ id: appId, pid: extra.pid, updatedAt: now })
    }
  }

  updatePid(appId: string, pid: number | null): void {
    this.stmtUpdatePid.run({ id: appId, pid, updatedAt: new Date().toISOString() })
  }

  incrementCrashCount(appId: string): void {
    this.stmtIncrementCrash.run({
      id:        appId,
      lastCrashAt: new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    })
  }

  resetCrashCount(appId: string): void {
    this.stmtResetCrash.run({ id: appId, updatedAt: new Date().toISOString() })
  }

  saveWindowBounds(appId: string, bounds: WindowBounds): void {
    this.stmtSaveWindowBounds.run({
      id:           appId,
      windowBounds: JSON.stringify(bounds),
      updatedAt:    new Date().toISOString(),
    })
  }

  listApps(): AppRow[] {
    return this.stmtListApps.all() as AppRow[]
  }

  deleteApp(appId: string): void {
    this.stmtDeleteApp.run(appId)
  }

  /** Reset transient states on Desktop startup (previously-running apps → stopped) */
  restoreOnStartup(): void {
    this.stmtRestoreOnStartup.run(new Date().toISOString())
  }

  // ── Row → AppMeta ──────────────────────────────────────────────────────────

  rowToMeta(row: AppRow): AppMeta {
    const meta: AppMeta = {
      id:          row.id,
      name:        row.name,
      skillIds:    JSON.parse(row.skillIds) as string[],
      status:      row.status,
      outputDir:   row.outputDir,
      entryPoint:  row.entryPoint,
      createdAt:   row.createdAt,
      updatedAt:   row.updatedAt,
      version:     row.version,
      crashCount:  row.crashCount,
    }
    if (row.description != null)  meta.description  = row.description
    if (row.lastCrashAt != null)  meta.lastCrashAt  = row.lastCrashAt
    if (row.pid != null)          meta.pid          = row.pid
    if (row.windowBounds != null) {
      meta.windowBounds = JSON.parse(row.windowBounds) as WindowBounds
    }
    return meta
  }
}
