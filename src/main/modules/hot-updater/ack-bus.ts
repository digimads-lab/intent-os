/**
 * hotUpdateAckBus — shared EventEmitter for hot-update acknowledgements.
 *
 * Extracted into its own module to avoid the circular-dependency that would
 * arise if rpc-dispatcher imported directly from hot-updater (which imports
 * socket-server, which imports rpc-dispatcher).
 *
 * Usage:
 *   // In the status.report RPC handler (rpc-dispatcher or lifecycle-manager):
 *   hotUpdateAckBus.emit('status', appId, status)
 *
 *   // In HotUpdater, to wait for confirmation:
 *   hotUpdateAckBus.on('status', (appId, status) => { ... })
 */

import { EventEmitter } from 'events'

/** Emitted when a SkillApp sends status.report. Payload: (appId: string, status: string) */
export const hotUpdateAckBus = new EventEmitter()
hotUpdateAckBus.setMaxListeners(50)
