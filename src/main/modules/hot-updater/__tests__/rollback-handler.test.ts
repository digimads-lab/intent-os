/**
 * Unit tests for RollbackHandler (M-06)
 *
 * Strategy:
 * - All dependencies (BackupManager, LifecycleManager, HotUpdater, BrowserWindow)
 *   are fully mocked with vi.fn() so no real fs or process operations run.
 * - onAppStatusChanged captures the registered callback so we can trigger crash
 *   events programmatically.
 * - The RollbackHandler registers the callback as `void this.onStatusChanged(event)`,
 *   so capturedCallback() returns void. We flush microtasks with flushAsync() so
 *   the internal async work completes before assertions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MockInstance } from 'vitest'

// ── Electron mock ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
  BrowserWindow: class {
    isDestroyed = vi.fn(() => false)
    webContents = { send: vi.fn() }
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { BrowserWindow } from 'electron'
import { RollbackHandler } from '../rollback-handler'
import type { BackupManager } from '../backup-manager'
import type { HotUpdater } from '../hot-updater'
import type { LifecycleManager } from '../../lifecycle-manager/lifecycle-manager'
import type { AppStatusEvent } from '../../lifecycle-manager/types'
import type { AppMeta } from '../../lifecycle-manager/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The RollbackHandler wraps the async onStatusChanged with `void`, so the
 * registered callback itself returns void. We flush microtasks so the internal
 * async work (restoreBackup, launchApp, notifyDesktop) completes before
 * assertions.
 */
const flushAsync = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** Captured status-change callback registered by RollbackHandler.initialize() */
type StatusCallback = (event: AppStatusEvent) => void

/** Build a mock AppMeta entry for use in lifecycleManager.listApps() */
function makeAppMeta(id: string, outputDir = '/tmp/app'): AppMeta {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Test App',
    description: '',
    skillIds: [],
    status: 'running',
    outputDir,
    entryPoint: 'main.js',
    createdAt: now,
    updatedAt: now,
    version: 1,
    crashCount: 0,
  }
}

/** Build a crashed AppStatusEvent */
function makeCrashEvent(appId: string): AppStatusEvent {
  return {
    appId,
    status: 'crashed',
    previousStatus: 'running',
    timestamp: Date.now(),
    crashCount: 1,
  }
}

interface MockDeps {
  backupManager: BackupManager & {
    restoreBackup: MockInstance
    createBackup: MockInstance
    listBackups: MockInstance
    deleteBackup: MockInstance
  }
  lifecycleManager: LifecycleManager & {
    onAppStatusChanged: MockInstance
    listApps: MockInstance
    launchApp: MockInstance
  }
  hotUpdater: HotUpdater & {
    getLastBackupId: MockInstance
    applyHotUpdate: MockInstance
  }
  mainWindow: BrowserWindow & {
    isDestroyed: MockInstance
    webContents: { send: MockInstance }
  }
  /** The callback captured when onAppStatusChanged is called */
  readonly capturedCallback: StatusCallback | null
}

function makeMocks(appId = 'app-1', outputDir = '/tmp/app'): MockDeps {
  let capturedCallback: StatusCallback | null = null

  const backupManager = {
    createBackup: vi.fn().mockResolvedValue('backup-id-001'),
    restoreBackup: vi.fn().mockResolvedValue(undefined),
    listBackups: vi.fn().mockResolvedValue([]),
    deleteBackup: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockDeps['backupManager']

  const lifecycleManager = {
    onAppStatusChanged: vi.fn().mockImplementation((cb: StatusCallback) => {
      capturedCallback = cb
      return () => { capturedCallback = null }
    }),
    listApps: vi.fn().mockResolvedValue([makeAppMeta(appId, outputDir)]),
    launchApp: vi.fn().mockResolvedValue(undefined),
    registerApp: vi.fn(),
    stopApp: vi.fn(),
    getAppStatus: vi.fn(),
    handleCrash: vi.fn(),
    uninstallApp: vi.fn(),
    isStopRequested: vi.fn(),
  } as unknown as MockDeps['lifecycleManager']

  const hotUpdater = {
    getLastBackupId: vi.fn().mockReturnValue('backup-id-001'),
    applyHotUpdate: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockDeps['hotUpdater']

  const mainWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: vi.fn() },
  } as unknown as MockDeps['mainWindow']

  return {
    backupManager,
    lifecycleManager,
    hotUpdater,
    mainWindow,
    get capturedCallback() { return capturedCallback },
  }
}

/** Fire the captured callback and wait for internal async work to settle. */
async function fireCrash(mocks: MockDeps, appId: string): Promise<void> {
  mocks.capturedCallback!(makeCrashEvent(appId))
  await flushAsync()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RollbackHandler', () => {
  let mocks: MockDeps
  let handler: RollbackHandler

  beforeEach(() => {
    mocks = makeMocks()
    handler = new RollbackHandler(
      mocks.backupManager,
      mocks.lifecycleManager,
      mocks.hotUpdater,
      mocks.mainWindow as unknown as BrowserWindow,
    )
  })

  afterEach(() => {
    handler.destroy()
    vi.restoreAllMocks()
  })

  // ── initialize / destroy ────────────────────────────────────────────────────

  describe('initialize', () => {
    it('registers an onAppStatusChanged listener', () => {
      handler.initialize()
      expect(mocks.lifecycleManager.onAppStatusChanged).toHaveBeenCalledOnce()
    })

    it('is idempotent — calling initialize() twice registers the listener only once', () => {
      handler.initialize()
      handler.initialize()
      expect(mocks.lifecycleManager.onAppStatusChanged).toHaveBeenCalledOnce()
    })
  })

  // ── rollback triggered by crash after hot-update ────────────────────────────

  describe('onStatusChanged — crash after hot update', () => {
    beforeEach(() => {
      handler.initialize()
    })

    it('triggers rollback when hotUpdater.getLastBackupId returns a backupId', async () => {
      mocks.hotUpdater.getLastBackupId.mockReturnValue('backup-id-001')

      await fireCrash(mocks, 'app-1')

      expect(mocks.backupManager.restoreBackup).toHaveBeenCalledOnce()
    })

    it('does NOT trigger rollback when getLastBackupId returns undefined (never hot-updated)', async () => {
      mocks.hotUpdater.getLastBackupId.mockReturnValue(undefined)

      await fireCrash(mocks, 'app-1')

      expect(mocks.backupManager.restoreBackup).not.toHaveBeenCalled()
      expect(mocks.lifecycleManager.launchApp).not.toHaveBeenCalled()
    })

    it('does NOT rollback for crash events from apps that were never hot-updated', async () => {
      mocks.hotUpdater.getLastBackupId.mockImplementation((id: string) =>
        id === 'hot-updated-app' ? 'some-backup' : undefined,
      )

      await fireCrash(mocks, 'pristine-app')

      expect(mocks.backupManager.restoreBackup).not.toHaveBeenCalled()
    })

    it('ignores non-crash status events (e.g. "stopped")', async () => {
      const stoppedEvent: AppStatusEvent = {
        appId: 'app-1',
        status: 'stopped',
        previousStatus: 'running',
        timestamp: Date.now(),
      }

      mocks.capturedCallback!(stoppedEvent)
      await flushAsync()

      expect(mocks.backupManager.restoreBackup).not.toHaveBeenCalled()
      expect(mocks.lifecycleManager.launchApp).not.toHaveBeenCalled()
    })
  })

  // ── call order: restoreBackup then launchApp ────────────────────────────────

  describe('rollback call order', () => {
    it('calls restoreBackup BEFORE launchApp', async () => {
      handler.initialize()

      const callOrder: string[] = []
      mocks.backupManager.restoreBackup.mockImplementation(async () => {
        callOrder.push('restoreBackup')
      })
      mocks.lifecycleManager.launchApp.mockImplementation(async () => {
        callOrder.push('launchApp')
      })

      await fireCrash(mocks, 'app-1')

      expect(callOrder).toEqual(['restoreBackup', 'launchApp'])
    })

    it('calls restoreBackup with correct appId, backupId, and outputDir', async () => {
      handler.initialize()

      await fireCrash(mocks, 'app-1')

      expect(mocks.backupManager.restoreBackup).toHaveBeenCalledWith(
        'app-1',
        'backup-id-001',
        '/tmp/app',
      )
    })

    it('calls launchApp with the correct appId', async () => {
      handler.initialize()

      await fireCrash(mocks, 'app-1')

      expect(mocks.lifecycleManager.launchApp).toHaveBeenCalledWith('app-1')
    })
  })

  // ── notification to mainWindow ──────────────────────────────────────────────

  describe('notification after rollback', () => {
    it('sends notification:show to mainWindow after successful rollback', async () => {
      handler.initialize()

      await fireCrash(mocks, 'app-1')

      expect(mocks.mainWindow.webContents.send).toHaveBeenCalledWith(
        'notification:show',
        expect.objectContaining({ type: 'warning' }),
      )
    })

    it('does NOT send notification when mainWindow is destroyed', async () => {
      mocks.mainWindow.isDestroyed.mockReturnValue(true)
      // Reconstruct handler with the updated mainWindow
      handler.destroy()
      handler = new RollbackHandler(
        mocks.backupManager,
        mocks.lifecycleManager,
        mocks.hotUpdater,
        mocks.mainWindow as unknown as BrowserWindow,
      )
      handler.initialize()

      await fireCrash(mocks, 'app-1')

      expect(mocks.mainWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('includes the rollback message text in the notification payload', async () => {
      handler.initialize()

      await fireCrash(mocks, 'app-1')

      const sendCalls = (mocks.mainWindow.webContents.send as MockInstance).mock.calls
      expect(sendCalls.length).toBeGreaterThanOrEqual(1)
      const [channel, payload] = sendCalls[0]
      expect(channel).toBe('notification:show')
      expect((payload as { message: string }).message).toContain('回滚')
    })
  })

  // ── error handling ──────────────────────────────────────────────────────────

  describe('rollback error handling', () => {
    it('does not throw when restoreBackup fails — swallows the error', async () => {
      handler.initialize()
      mocks.backupManager.restoreBackup.mockRejectedValueOnce(new Error('disk full'))

      // capturedCallback() returns void; we just await flushAsync to let it settle
      mocks.capturedCallback!(makeCrashEvent('app-1'))
      await flushAsync()

      // No assertion needed beyond "did not throw" — if the test reaches here it passed
    })

    it('does not call launchApp when restoreBackup fails', async () => {
      handler.initialize()
      mocks.backupManager.restoreBackup.mockRejectedValueOnce(new Error('disk full'))

      await fireCrash(mocks, 'app-1')

      expect(mocks.lifecycleManager.launchApp).not.toHaveBeenCalled()
    })

    it('does not throw when app is not found in listApps registry', async () => {
      handler.initialize()
      mocks.lifecycleManager.listApps.mockResolvedValueOnce([])

      // Should complete without throwing even when app not found
      mocks.capturedCallback!(makeCrashEvent('app-1'))
      await flushAsync()
    })
  })

  // ── destroy ─────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('unsubscribes listener so destroy() nulls out the capturedCallback', () => {
      handler.initialize()
      expect(mocks.capturedCallback).not.toBeNull()

      handler.destroy()

      // The unsubscribe fn sets capturedCallback = null in our mock
      expect(mocks.capturedCallback).toBeNull()
    })
  })
})
