/**
 * M-03 LifecycleManager — complete type definitions
 */

import type { ChildProcess } from 'child_process'
import type { AppStatus } from './app-status'

// ── WindowBounds ──────────────────────────────────────────────────────────────

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized?: boolean
  isMinimized?: boolean
}

// ── AppMeta ───────────────────────────────────────────────────────────────────

/**
 * SkillApp metadata as exposed to callers.
 * This is the module-local definition (richer than @intentos/shared-types AppMeta).
 */
export interface AppMeta {
  /** Unique identifier assigned by M-05 generator */
  id: string
  /** Display name */
  name: string
  /** Optional description */
  description?: string
  /** Skill IDs this app depends on */
  skillIds: string[]
  /** Current lifecycle status */
  status: AppStatus
  /** Absolute path to the SkillApp output directory */
  outputDir: string
  /** Relative path to Electron main entry (e.g. 'main.js') */
  entryPoint: string
  /** ISO 8601 creation timestamp */
  createdAt: string
  /** ISO 8601 last-updated timestamp */
  updatedAt: string
  /** Incrementing version number; hot-update bumps this */
  version: number
  /** Number of crashes since last reset */
  crashCount: number
  /** ISO 8601 timestamp of last crash */
  lastCrashAt?: string
  /** OS process ID (present while running) */
  pid?: number
  /** Last known window geometry */
  windowBounds?: WindowBounds
}

// ── AppStatusEvent ────────────────────────────────────────────────────────────

/**
 * Emitted whenever any app transitions to a new status.
 */
export interface AppStatusEvent {
  appId: string
  /** New status */
  status: AppStatus
  /** Previous status */
  previousStatus: AppStatus
  /** Unix epoch ms */
  timestamp: number
  /** Crash count — present when status is 'crashed' or 'restarting' */
  crashCount?: number
  /** Error detail — present when the transition was caused by an error */
  error?: {
    code: string
    message: string
  }
}

// ── LaunchConfig ──────────────────────────────────────────────────────────────

export interface LaunchConfig {
  appId: string
  /** Absolute path to the app entry file */
  appPath: string
  /** Unix socket path (or named pipe on Windows) */
  ipcPath: string
  windowBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  environment?: Record<string, string>
}

// ── ProcessEntry ──────────────────────────────────────────────────────────────

/**
 * In-memory record for a running (or starting) process.
 */
export interface ProcessEntry {
  child: ChildProcess
  ipcPath: string
  /** Unix epoch ms when the process was spawned */
  startedAt: number
  /** Unix epoch ms of last heartbeat from the process */
  lastHeartbeatAt?: number
}

// ── ICrashNotification ────────────────────────────────────────────────────────

/**
 * Passed from ProcessWatcher to LifecycleManager when a process exits abnormally.
 */
export interface ICrashNotification {
  appId: string
  exitCode: number
  signal: string
  timestamp: number
}

// ── AppError ──────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 500
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// ── AppRow (internal DB row shape) ───────────────────────────────────────────

/**
 * Raw row returned by better-sqlite3 for the apps table.
 * All JSON fields are stored as TEXT strings.
 */
export interface AppRow {
  id: string
  name: string
  description: string | null
  version: number
  skillIds: string        // JSON array
  status: AppStatus
  outputDir: string
  entryPoint: string
  pid: number | null
  windowBounds: string | null       // JSON
  windowBoundsSaved: string | null  // JSON
  crashCount: number
  lastCrashAt: string | null
  lastRestartAt: string | null
  stableRunningSeconds: number | null
  createdAt: string
  updatedAt: string
  permissions: string | null   // JSON
  environment: string | null   // JSON
}
