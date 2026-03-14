/**
 * M-03 LifecycleManager — public entry point
 *
 * Usage:
 *   import { lifecycleManager } from './modules/lifecycle-manager'
 */

import { app } from 'electron'
import path from 'path'

import { LifecycleManager } from './lifecycle-manager'

// ── Singleton ─────────────────────────────────────────────────────────────────

const DB_PATH = path.join(app.getPath('userData'), 'intentos-apps.db')

export const lifecycleManager = new LifecycleManager(DB_PATH)

// ── Re-exports ────────────────────────────────────────────────────────────────

export { LifecycleManager } from './lifecycle-manager'
export { AppRegistry }      from './app-registry'
export { ProcessWatcher }   from './process-watcher'
export { AppStatusMeanings } from './app-status'
export type { AppStatus }   from './app-status'
export type {
  AppMeta,
  AppStatusEvent,
  LaunchConfig,
  WindowBounds,
  ProcessEntry,
  ICrashNotification,
  AppRow,
} from './types'
export { AppError } from './types'
export * from './config'
