/**
 * Unit tests for morphToSkillApp (原地变形 Phase 1)
 *
 * Strategy:
 * - electron is vi.mock'd (BrowserWindow, webContents) — same pattern as
 *   lifecycle-manager.test.ts.
 * - @electron-toolkit/utils and window-manager are vi.mock'd to avoid crashes.
 * - lifecycleManager singleton is vi.mock'd via '../../lifecycle-manager'
 *   (path relative to THIS test file) so the hoisted factory intercepts the
 *   module before morph-phase1.ts evaluates it.
 * - vi.hoisted() is used for shared state referenced inside vi.mock factories,
 *   which Vitest hoists to the top of the file before variable declarations.
 * - vi.useFakeTimers() controls the 15s MORPH_TIMEOUT_MS.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Hoisted shared state (accessible inside vi.mock factories) ─────────────────

const { statusHandlers, mockLifecycleManager, mockGenWin } = vi.hoisted(() => {
  const statusHandlers: Array<(e: { appId: string; status: string }) => void> = []

  const mockLifecycleManager = {
    launchApp: vi.fn(),
    onAppStatusChanged: vi.fn((handler: (e: { appId: string; status: string }) => void) => {
      statusHandlers.push(handler)
      return () => {
        const idx = statusHandlers.indexOf(handler)
        if (idx !== -1) statusHandlers.splice(idx, 1)
      }
    }),
    listApps: vi.fn(async () => []),
  }

  const mockGenWin = {
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 100, y: 200, width: 800, height: 600 })),
    hide: vi.fn(),
    close: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setBounds: vi.fn(),
  }

  return { statusHandlers, mockLifecycleManager, mockGenWin }
})

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  default: {
    app: { getPath: vi.fn(() => '/tmp/test-intentos') },
    BrowserWindow: {
      fromId: vi.fn(() => mockGenWin),
      fromWebContents: vi.fn(() => null),
      getAllWindows: vi.fn(() => []),
    },
    webContents: { getAllWebContents: vi.fn(() => []) },
    shell: {},
    ipcMain: { on: vi.fn(), handle: vi.fn() },
  },
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
  BrowserWindow: {
    fromId: vi.fn(() => mockGenWin),
    fromWebContents: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
  webContents: { getAllWebContents: vi.fn(() => []) },
  shell: {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
  optimizer: { watchWindowShortcuts: vi.fn() },
}))

vi.mock('../../window-manager', () => ({
  windowManager: {
    getMainWindow: vi.fn(() => null),
    isDestroyed: vi.fn(() => false),
  },
}))

// This path is relative to THIS test file (morphing/__tests__/).
// morph-phase1.ts uses '../lifecycle-manager' (relative to morphing/), which
// resolves to the same absolute path — Vitest deduplicates by resolved path.
vi.mock('../../lifecycle-manager', () => ({
  lifecycleManager: mockLifecycleManager,
  LifecycleManager: vi.fn(),
  AppRegistry: vi.fn(),
  ProcessWatcher: vi.fn(),
  AppError: class AppError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { morphToSkillApp } from '../morph-phase1'
import { BrowserWindow } from 'electron'

// ── Helpers ───────────────────────────────────────────────────────────────────

function emitRunning(appId: string): void {
  for (const handler of [...statusHandlers]) {
    handler({ appId, status: 'running' })
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('morphToSkillApp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    statusHandlers.length = 0

    // Default: launchApp resolves immediately
    mockLifecycleManager.launchApp.mockResolvedValue(undefined)
    mockLifecycleManager.listApps.mockResolvedValue([])

    // Restore onAppStatusChanged after clearAllMocks
    mockLifecycleManager.onAppStatusChanged.mockImplementation(
      (handler: (e: { appId: string; status: string }) => void) => {
        statusHandlers.push(handler)
        return () => {
          const idx = statusHandlers.indexOf(handler)
          if (idx !== -1) statusHandlers.splice(idx, 1)
        }
      }
    )

    // Restore mockGenWin to non-destroyed state
    mockGenWin.isDestroyed.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── Timeout degradation ────────────────────────────────────────────────────

  describe('timeout degradation', () => {
    it('completes without throwing after 15s when no running event arrives', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-1',
        generationWindowId: 1,
        appId: 'app-timeout',
      })

      await vi.advanceTimersByTimeAsync(15_001)

      await expect(morphPromise).resolves.toBeDefined()
    })

    it('returns a MorphResult with appId field after timeout', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-2',
        generationWindowId: 1,
        appId: 'app-timeout',
      })

      await vi.advanceTimersByTimeAsync(15_001)

      const result = await morphPromise
      expect(result.appId).toBe('app-timeout')
      expect(typeof result.success).toBe('boolean')
    })

    it('still calls hide and close on the generation window after timeout', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-3',
        generationWindowId: 1,
        appId: 'app-timeout',
      })

      await vi.advanceTimersByTimeAsync(15_001)
      await morphPromise

      expect(mockGenWin.hide).toHaveBeenCalled()
      expect(mockGenWin.close).toHaveBeenCalled()
    })
  })

  // ── Successful morph ───────────────────────────────────────────────────────

  describe('successful morph', () => {
    it('resolves promptly when running event fires within 15s', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-4',
        generationWindowId: 1,
        appId: 'app-ok',
      })

      await vi.advanceTimersByTimeAsync(100)
      emitRunning('app-ok')

      const result = await morphPromise
      expect(result.appId).toBe('app-ok')
    })

    it('returns success:true when running event fires', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-5',
        generationWindowId: 1,
        appId: 'app-ok',
      })

      await vi.advanceTimersByTimeAsync(100)
      emitRunning('app-ok')

      const result = await morphPromise
      expect(result.success).toBe(true)
    })

    it('hides and closes the generation window on successful morph', async () => {
      const morphPromise = morphToSkillApp({
        sessionId: 'sess-6',
        generationWindowId: 1,
        appId: 'app-ok',
      })

      await vi.advanceTimersByTimeAsync(100)
      emitRunning('app-ok')
      await morphPromise

      expect(mockGenWin.hide).toHaveBeenCalled()
      expect(mockGenWin.close).toHaveBeenCalled()
    })
  })

  // ── launchApp failure ──────────────────────────────────────────────────────

  describe('launchApp failure', () => {
    it('returns success:false when launchApp rejects', async () => {
      mockLifecycleManager.launchApp.mockRejectedValue(new Error('spawn failed'))

      const result = await morphToSkillApp({
        sessionId: 'sess-7',
        generationWindowId: 1,
        appId: 'app-fail',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('spawn failed')
    })
  })

  // ── Missing generation window ──────────────────────────────────────────────

  describe('missing generation window', () => {
    it('returns success:false when the generation window does not exist', async () => {
      vi.mocked(BrowserWindow.fromId).mockReturnValueOnce(null as never)

      const result = await morphToSkillApp({
        sessionId: 'sess-8',
        generationWindowId: 999,
        appId: 'app-nowin',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
