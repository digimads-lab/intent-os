/**
 * Unit tests for LifecycleManager (M-03)
 *
 * Strategy:
 * - In-memory SQLite (':memory:') so no real files are needed and tests are
 *   fully isolated.  LifecycleManager accepts a dbPath string; ':memory:' is
 *   passed directly.
 * - child_process.spawn is vi.mock'd to return a fake ChildProcess that we can
 *   control programmatically (emit 'message', 'exit', 'error' events).
 * - window-manager is vi.mock'd so emitStatusChanged() does not crash when
 *   it calls windowManager.getMainWindow().
 * - Each test creates a fresh LifecycleManager to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { EventEmitter } from 'events'

// ── Mocks — must be declared before importing the module under test ────────────

vi.mock('electron', () => ({
  default: {
    app: { getPath: vi.fn(() => '/tmp/test-intentos') },
    BrowserWindow: class {},
    shell: {},
    ipcMain: { on: vi.fn(), handle: vi.fn() },
  },
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
  BrowserWindow: class {},
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

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
  }
})

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { spawn } from 'child_process'
import { LifecycleManager } from '../lifecycle-manager'
import { AppError } from '../types'
import type { AppMeta, AppStatusEvent } from '../types'
import type { AppStatus } from '../app-status'

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockSpawn = spawn as unknown as MockInstance

/**
 * A fake ChildProcess that exposes send(), kill(), and EventEmitter events.
 * We use it to simulate IPC handshake, exit, error, etc.
 */
class FakeChildProcess extends EventEmitter {
  killed = false
  pid: number | undefined

  constructor(pid = 12345) {
    super()
    this.pid = pid
  }

  send(msg: unknown): boolean {
    // Simulate IPC send succeeding
    void msg
    return true
  }

  kill(_signal?: string): boolean {
    this.killed = true
    // Emit exit so waitForProcessExit resolves
    process.nextTick(() => this.emit('exit', 0, null))
    return true
  }
}

/** Install mockSpawn to return a new FakeChildProcess and return it. */
function setupFakeSpawn(pid = 12345): FakeChildProcess {
  const fake = new FakeChildProcess(pid)
  mockSpawn.mockReturnValue(fake)
  return fake
}

/** Build a minimal AppMeta for registerApp(). */
function makeAppMeta(overrides: Partial<AppMeta> = {}): AppMeta {
  const now = new Date().toISOString()
  return {
    id:          'test-app-1',
    name:        'Test App',
    description: 'For testing',
    skillIds:    ['skill-1'],
    status:      'registered',
    outputDir:   '/tmp/test-app-1',
    entryPoint:  'main.js',
    createdAt:   now,
    updatedAt:   now,
    version:     1,
    crashCount:  0,
    ...overrides,
  }
}

/** Create a fresh LifecycleManager backed by an in-memory SQLite database. */
function createManager(): LifecycleManager {
  return new LifecycleManager(':memory:')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LifecycleManager', () => {
  let manager: LifecycleManager

  beforeEach(() => {
    manager = createManager()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── registerApp ─────────────────────────────────────────────────────────────

  describe('registerApp', () => {
    it("sets initial status to 'registered'", async () => {
      await manager.registerApp(makeAppMeta())
      const status = await manager.getAppStatus('test-app-1')
      expect(status).toBe('registered')
    })

    it('makes the app appear in listApps()', async () => {
      await manager.registerApp(makeAppMeta())
      const apps = await manager.listApps()
      expect(apps).toHaveLength(1)
      expect(apps[0].id).toBe('test-app-1')
    })

    it('stores the provided name and description', async () => {
      await manager.registerApp(makeAppMeta({ name: 'My App', description: 'nice app' }))
      const apps = await manager.listApps()
      expect(apps[0].name).toBe('My App')
      expect(apps[0].description).toBe('nice app')
    })
  })

  // ── launchApp — state transitions ──────────────────────────────────────────

  describe('launchApp — state transitions', () => {
    it("transitions through 'starting' → 'running' on successful IPC handshake", async () => {
      await manager.registerApp(makeAppMeta())

      const fake = setupFakeSpawn()
      const statusChanges: AppStatus[] = []
      manager.onAppStatusChanged(e => statusChanges.push(e.status))

      const launchPromise = manager.launchApp('test-app-1')

      // Simulate IPC handshake before the promise resolves
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })

      await launchPromise

      expect(statusChanges).toContain('starting')
      expect(statusChanges).toContain('running')
      expect(await manager.getAppStatus('test-app-1')).toBe('running')
    })

    it("throws APP_ALREADY_RUNNING when app is already 'running'", async () => {
      await manager.registerApp(makeAppMeta())

      const fake = setupFakeSpawn()
      const launchPromise = manager.launchApp('test-app-1')
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })
      await launchPromise

      await expect(manager.launchApp('test-app-1')).rejects.toMatchObject({
        code: 'APP_ALREADY_RUNNING',
      })
    })

    it('throws APP_NOT_FOUND for an unknown appId', async () => {
      await expect(manager.launchApp('ghost-app')).rejects.toMatchObject({
        code: 'APP_NOT_FOUND',
      })
    })
  })

  // ── stopApp — idempotency and state ────────────────────────────────────────

  describe('stopApp', () => {
    it("returns immediately without throwing when app is already 'stopped'", async () => {
      await manager.registerApp(makeAppMeta())
      // Manually transition to stopped without launching
      // Register → status is 'registered', not stopped yet; we need to stop from stopped.
      // registerApp gives 'registered'; to get stopped we launch + stop:
      const fake = setupFakeSpawn()
      const launchPromise = manager.launchApp('test-app-1')
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })
      await launchPromise

      await manager.stopApp('test-app-1')
      // Second stop should be idempotent
      await expect(manager.stopApp('test-app-1')).resolves.not.toThrow()
    })

    it("sets status to 'stopped' after stopping a running app", async () => {
      await manager.registerApp(makeAppMeta())

      const fake = setupFakeSpawn()
      const launchPromise = manager.launchApp('test-app-1')
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })
      await launchPromise

      await manager.stopApp('test-app-1')

      expect(await manager.getAppStatus('test-app-1')).toBe('stopped')
    })

    it('throws APP_NOT_FOUND when stopping a non-existent app', async () => {
      await expect(manager.stopApp('ghost-app')).rejects.toMatchObject({
        code: 'APP_NOT_FOUND',
      })
    })
  })

  // ── uninstallApp ────────────────────────────────────────────────────────────

  describe('uninstallApp', () => {
    it('removes the app from listApps() after uninstall', async () => {
      await manager.registerApp(makeAppMeta())

      await manager.uninstallApp('test-app-1')

      const apps = await manager.listApps()
      expect(apps.find(a => a.id === 'test-app-1')).toBeUndefined()
    })

    it('throws APP_NOT_FOUND when trying to get status after uninstall', async () => {
      await manager.registerApp(makeAppMeta())
      await manager.uninstallApp('test-app-1')

      await expect(manager.getAppStatus('test-app-1')).rejects.toMatchObject({
        code: 'APP_NOT_FOUND',
      })
    })

    it('throws APP_NOT_FOUND for an unknown appId', async () => {
      await expect(manager.uninstallApp('ghost-app')).rejects.toMatchObject({
        code: 'APP_NOT_FOUND',
      })
    })

    it('emits an uninstalling status event followed by a stopped event', async () => {
      await manager.registerApp(makeAppMeta())

      const events: AppStatusEvent[] = []
      manager.onAppStatusChanged(e => events.push(e))

      await manager.uninstallApp('test-app-1')

      const statuses = events.map(e => e.status)
      expect(statuses).toContain('uninstalling')
      expect(statuses).toContain('stopped')
    })
  })

  // ── crash handling and restart budget ─────────────────────────────────────

  describe('handleCrash — crash counting and restart scheduling', () => {
    it('increments crashCount on each handleCrash call', async () => {
      await manager.registerApp(makeAppMeta())

      const events: AppStatusEvent[] = []
      manager.onAppStatusChanged(e => events.push(e))

      await manager.handleCrash('test-app-1', {
        appId: 'test-app-1', exitCode: 1, signal: 'null', timestamp: Date.now(),
      })

      const crashedEvent = events.find(e => e.status === 'crashed')
      expect(crashedEvent?.crashCount).toBe(1)
    })

    it('schedules restart (emits restarting) for crashes 1 through 3', async () => {
      vi.useFakeTimers()
      try {
        const m = createManager()
        await m.registerApp(makeAppMeta())

        const statuses: AppStatus[] = []
        m.onAppStatusChanged(e => statuses.push(e.status))

        // First crash — should trigger restarting
        await m.handleCrash('test-app-1', {
          appId: 'test-app-1', exitCode: 1, signal: 'null', timestamp: Date.now(),
        })

        expect(statuses).toContain('crashed')
        expect(statuses).toContain('restarting')

        // Clear all pending fake timers before restoring real timers so the
        // scheduled restart callback never fires after useRealTimers(), which
        // would trigger a real spawn() and cause a segfault.
        vi.clearAllTimers()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does NOT schedule restart after 4th crash (crashCount > MAX_CRASH_COUNT=3)', async () => {
      vi.useFakeTimers()
      try {
        const m = createManager()
        // Start with crashCount already at 3 so the next crash tips over the limit
        await m.registerApp(makeAppMeta({ crashCount: 3 }))

        const statuses: AppStatus[] = []
        m.onAppStatusChanged(e => statuses.push(e.status))

        await m.handleCrash('test-app-1', {
          appId: 'test-app-1', exitCode: 1, signal: 'null', timestamp: Date.now(),
        })

        // Should be crashed but NOT restarting
        expect(statuses).toContain('crashed')
        expect(statuses).not.toContain('restarting')

        // Even after time passes, status stays crashed (no pending restart)
        vi.advanceTimersByTime(5000)
        expect(await m.getAppStatus('test-app-1')).toBe('crashed')

        vi.clearAllTimers()
      } finally {
        vi.useRealTimers()
      }
    })

    it('emits crashed event with the correct cumulative crashCount', async () => {
      await manager.registerApp(makeAppMeta({ crashCount: 2 }))

      const events: AppStatusEvent[] = []
      manager.onAppStatusChanged(e => events.push(e))

      await manager.handleCrash('test-app-1', {
        appId: 'test-app-1', exitCode: 1, signal: 'null', timestamp: Date.now(),
      })

      const crashedEvent = events.find(e => e.status === 'crashed')
      // Pre-existing 2 crashes + this one = 3
      expect(crashedEvent?.crashCount).toBe(3)
    })

    it('silently returns when handleCrash is called for an unknown appId', async () => {
      await expect(
        manager.handleCrash('unknown-app', {
          appId: 'unknown-app', exitCode: 1, signal: 'null', timestamp: Date.now(),
        }),
      ).resolves.not.toThrow()
    })
  })

  // ── onAppStatusChanged subscription ───────────────────────────────────────

  describe('onAppStatusChanged', () => {
    it('calls the handler when status changes', async () => {
      await manager.registerApp(makeAppMeta())

      const handler = vi.fn()
      manager.onAppStatusChanged(handler)

      const fake = setupFakeSpawn()
      const launchPromise = manager.launchApp('test-app-1')
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })
      await launchPromise

      expect(handler).toHaveBeenCalled()
    })

    it('stops calling the handler after unsubscribing', async () => {
      await manager.registerApp(makeAppMeta())

      const handler = vi.fn()
      const unsubscribe = manager.onAppStatusChanged(handler)
      unsubscribe()

      // Register a second app to trigger events
      await manager.registerApp(makeAppMeta({ id: 'app-2', outputDir: '/tmp/app-2' }))
      await manager.uninstallApp('app-2')

      expect(handler).not.toHaveBeenCalled()
    })

    it('includes appId, previousStatus, and timestamp in the event', async () => {
      await manager.registerApp(makeAppMeta())

      const events: AppStatusEvent[] = []
      manager.onAppStatusChanged(e => events.push(e))

      const fake = setupFakeSpawn()
      const launchPromise = manager.launchApp('test-app-1')
      await new Promise(resolve => process.nextTick(resolve))
      fake.emit('message', { type: 'ready', appId: 'test-app-1' })
      await launchPromise

      const runningEvent = events.find(e => e.status === 'running')
      expect(runningEvent).toBeDefined()
      expect(runningEvent?.appId).toBe('test-app-1')
      expect(runningEvent?.previousStatus).toBe('starting')
      expect(typeof runningEvent?.timestamp).toBe('number')
    })
  })

  // ── listApps — ordering ────────────────────────────────────────────────────

  describe('listApps — ordering', () => {
    it('returns apps ordered by createdAt descending (newest first)', async () => {
      const now = Date.now()

      // Register apps with explicit createdAt values
      await manager.registerApp(makeAppMeta({
        id:        'app-old',
        outputDir: '/tmp/app-old',
        createdAt: new Date(now - 10_000).toISOString(),
      }))

      await manager.registerApp(makeAppMeta({
        id:        'app-new',
        outputDir: '/tmp/app-new',
        createdAt: new Date(now).toISOString(),
      }))

      const apps = await manager.listApps()
      expect(apps).toHaveLength(2)
      expect(apps[0].id).toBe('app-new')
      expect(apps[1].id).toBe('app-old')
    })

    it('returns an empty array when no apps are registered', async () => {
      const apps = await manager.listApps()
      expect(apps).toEqual([])
    })

    it('returns multiple registered apps with correct field values', async () => {
      await manager.registerApp(makeAppMeta({ id: 'a1', outputDir: '/tmp/a1' }))
      await manager.registerApp(makeAppMeta({ id: 'a2', outputDir: '/tmp/a2' }))
      await manager.registerApp(makeAppMeta({ id: 'a3', outputDir: '/tmp/a3' }))

      const apps = await manager.listApps()
      expect(apps).toHaveLength(3)

      const ids = apps.map(a => a.id)
      expect(ids).toContain('a1')
      expect(ids).toContain('a2')
      expect(ids).toContain('a3')
    })
  })

  // ── getAppStatus ──────────────────────────────────────────────────────────

  describe('getAppStatus', () => {
    it("returns 'registered' immediately after registerApp", async () => {
      await manager.registerApp(makeAppMeta())
      expect(await manager.getAppStatus('test-app-1')).toBe('registered')
    })

    it('throws APP_NOT_FOUND for a non-existent appId', async () => {
      await expect(manager.getAppStatus('no-such-app')).rejects.toMatchObject({
        code: 'APP_NOT_FOUND',
      })
      await expect(manager.getAppStatus('no-such-app')).rejects.toBeInstanceOf(AppError)
    })
  })

  // ── AppError shape ────────────────────────────────────────────────────────

  describe('AppError', () => {
    it('is an instance of Error and has the expected code', async () => {
      let caught: unknown
      try {
        await manager.getAppStatus('ghost')
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(Error)
      expect(caught).toBeInstanceOf(AppError)
      expect((caught as AppError).code).toBe('APP_NOT_FOUND')
    })
  })

  // ── isStopRequested ───────────────────────────────────────────────────────

  describe('isStopRequested', () => {
    it('returns false when no stop has been requested', () => {
      expect(manager.isStopRequested('any-app')).toBe(false)
    })
  })
})
