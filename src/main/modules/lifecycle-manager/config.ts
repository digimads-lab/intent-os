/**
 * M-03 LifecycleManager — constant configuration
 */

// ── Crash recovery ────────────────────────────────────────────────────────────

/** Maximum number of automatic restarts before giving up */
export const MAX_CRASH_COUNT = 3

/**
 * Delay (ms) before each restart attempt.
 * Index 0 = 1st restart, index 1 = 2nd, index 2 = 3rd.
 */
export const RESTART_DELAY_MS: readonly number[] = [0, 1000, 2000]

/**
 * How long (ms) an app must run without crashing before its crash count
 * is reset to 0, giving it another MAX_CRASH_COUNT restart budget.
 */
export const STABLE_RUNNING_DURATION_MS = 5 * 60 * 1000  // 5 minutes

// ── Timeouts ──────────────────────────────────────────────────────────────────

/** How long (ms) to wait for the IPC handshake after spawn before marking crashed */
export const HANDSHAKE_TIMEOUT_MS = 5_000

/** How long (ms) to wait for graceful exit after SIGTERM before sending SIGKILL */
export const STOP_TIMEOUT_MS = 5_000

/** Interval (ms) at which the stable-running monitor fires */
export const STABLE_RUNNING_CHECK_INTERVAL_MS = 10_000
