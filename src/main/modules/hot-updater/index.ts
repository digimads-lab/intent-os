/**
 * M-05/M-06 Hot Updater — public entry point
 *
 * Usage:
 *   import { hotUpdater } from './modules/hot-updater'
 *   await hotUpdater.applyHotUpdate(appId, updatePackage, appDir)
 *
 * To wire up the ack bus (call this from the status.report handler):
 *   import { hotUpdateAckBus } from './modules/hot-updater'
 *   hotUpdateAckBus.emit('status', appId, status)
 */

import { HotUpdater } from './hot-updater'

export { HotUpdater }                    from './hot-updater'
export { hotUpdateAckBus }               from './ack-bus'
export type { HotUpdatePackage }         from './hot-updater'
export { BackupManager }                 from './backup-manager'
export type { BackupEntry }              from './backup-manager'
export { RollbackHandler, createRollbackHandler } from './rollback-handler'

// ── Singleton ─────────────────────────────────────────────────────────────────

export const hotUpdater = new HotUpdater()
