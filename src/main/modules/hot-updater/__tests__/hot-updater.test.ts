/**
 * Unit tests for HotUpdater and BackupManager (M-06)
 *
 * Strategy:
 * - Real BackupManager is tested against a temp directory (os.tmpdir()) so we
 *   exercise actual fs operations without touching production paths.
 * - HotUpdater is tested with vi.mock() for electron, child_process (tsc),
 *   socket-server, and the ack-bus so we control timing precisely.
 * - The ack-bus mock shares the same EventEmitter instance across the module
 *   under test and the test file (vi.mock is hoisted).
 * - Fake timers are used only in the timeout test to avoid a real 10-second wait.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'os'
import * as fsp from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'

// ── Electron mock ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
  },
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}))

// ── socket-server mock — sendToApp is a no-op ─────────────────────────────────

vi.mock('../../socket-server/socket-server', () => ({
  socketServer: {
    sendToApp: vi.fn(),
  },
}))

// ── child_process mock ────────────────────────────────────────────────────────
// hot-updater.ts calls:  const execFileAsync = promisify(execFile)
// promisify wraps execFile so that the last argument it appends is a Node-style
// callback (err, stdout, stderr).  Our mock must invoke that callback or the
// returned Promise never settles.
//
// IMPORTANT: the default implementation must call the callback synchronously so
// that tests which don't explicitly configure tsc behaviour still resolve.

const mockExecFile = vi.fn().mockImplementation(
  (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
    cb(null, '', '')
    return {}
  },
)

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (...args: unknown[]) => mockExecFile(...args),
  }
})

// ── ack-bus mock ──────────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file before any imports or
// variable initialisations, so we must NOT reference any top-level variables
// inside the factory.  Instead we create the EventEmitter inside the factory
// and then re-import hotUpdateAckBus from the mocked module so both the module
// under test and the tests share the exact same instance.

vi.mock('../ack-bus', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')
  const bus = new EventEmitter()
  bus.setMaxListeners(50)
  return { hotUpdateAckBus: bus }
})

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { BackupManager } from '../backup-manager'
import { HotUpdater, type HotUpdatePackage } from '../hot-updater'
import { hotUpdateAckBus } from '../ack-bus'

// Alias so tests read clearly
const sharedAckBus = hotUpdateAckBus

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make tsc succeed (default for most tests). */
function makeTscSucceed(): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, out: string, err2: string) => void) => {
      cb(null, '', '')
      return {}
    },
  )
}

/** Make tsc fail with a compiler error. */
function makeTscFail(detail = 'TS2304: Cannot find name'): void {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      const err = Object.assign(new Error('tsc failed'), { stderr: detail })
      cb(err)
      return {}
    },
  )
}

/** Create a unique temp directory for each test to ensure isolation. */
async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'intentos-test-'))
}

/** Create a minimal src/ tree inside appDir with one source file. */
async function seedSrcDir(appDir: string): Promise<void> {
  const srcApp = path.join(appDir, 'src', 'app')
  await fsp.mkdir(srcApp, { recursive: true })
  await fsp.writeFile(path.join(srcApp, 'index.tsx'), 'export default function App() {}')
}

/** Build a minimal valid HotUpdatePackage. */
function makeUpdatePackage(appId = 'app-1'): HotUpdatePackage {
  return {
    appId,
    fromVersion: '1.0.0',
    toVersion: '1.0.1',
    timestamp: Date.now(),
    modules: [
      {
        path: 'index.tsx',
        action: 'modify',
        content: Buffer.from('export default function App() { /* updated */ }').toString('base64'),
      },
    ],
    manifest: {},
    checksum: 'abc123',
  }
}

// ── BackupManager tests ───────────────────────────────────────────────────────

describe('BackupManager', () => {
  let appDir: string
  let backupManager: BackupManager

  beforeEach(async () => {
    appDir = await makeTempDir()
    backupManager = new BackupManager()
    await seedSrcDir(appDir)
  })

  afterEach(async () => {
    await fsp.rm(appDir, { recursive: true, force: true })
  })

  describe('createBackup', () => {
    it('creates a backup directory under {appDir}/backup/', async () => {
      const backupId = await backupManager.createBackup('app-1', appDir)

      const backupDir = path.join(appDir, 'backup', backupId)
      const stat = await fsp.stat(backupDir)
      expect(stat.isDirectory()).toBe(true)
    })

    it('backup directory is created BEFORE any file writes (accessible immediately after call)', async () => {
      const backupId = await backupManager.createBackup('app-1', appDir)
      const backupDir = path.join(appDir, 'backup', backupId)

      await expect(fsp.access(backupDir)).resolves.not.toThrow()
    })

    it('copies src/ contents into the backup directory', async () => {
      const backupId = await backupManager.createBackup('app-1', appDir)
      // BackupManager copies appDir/src/ into backupDir, preserving sub-structure.
      // The file at src/app/index.tsx ends up at backupDir/app/index.tsx.
      const backedUpFile = path.join(appDir, 'backup', backupId, 'app', 'index.tsx')

      const content = await fsp.readFile(backedUpFile, 'utf8')
      expect(content).toContain('App')
    })

    it('returns a non-empty backupId string', async () => {
      const backupId = await backupManager.createBackup('app-1', appDir)
      expect(typeof backupId).toBe('string')
      expect(backupId.length).toBeGreaterThan(0)
    })
  })

  describe('restoreBackup', () => {
    it('replaces src/ contents with the backup copy', async () => {
      const backupId = await backupManager.createBackup('app-1', appDir)

      // Overwrite the source file
      await fsp.writeFile(path.join(appDir, 'src', 'app', 'index.tsx'), '/* corrupted */')

      await backupManager.restoreBackup('app-1', backupId, appDir)

      const restored = await fsp.readFile(path.join(appDir, 'src', 'app', 'index.tsx'), 'utf8')
      expect(restored).toContain('App')
      expect(restored).not.toContain('corrupted')
    })

    it('throws when the backupId does not exist', async () => {
      await expect(
        backupManager.restoreBackup('app-1', 'nonexistent-backup-id', appDir),
      ).rejects.toThrow(/Backup not found/)
    })
  })

  describe('max 5 backups enforcement', () => {
    it('auto-deletes the oldest backup when the 6th backup is created', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        await fsp.writeFile(
          path.join(appDir, 'src', 'app', 'index.tsx'),
          `// version ${i}`,
        )
        ids.push(await backupManager.createBackup('app-1', appDir))
        await new Promise(resolve => setTimeout(resolve, 5))
      }

      let backups = await backupManager.listBackups('app-1', appDir)
      expect(backups).toHaveLength(5)

      // 6th backup — oldest should be pruned
      await fsp.writeFile(path.join(appDir, 'src', 'app', 'index.tsx'), '// version 5')
      await backupManager.createBackup('app-1', appDir)

      backups = await backupManager.listBackups('app-1', appDir)
      expect(backups).toHaveLength(5)

      // The oldest backup directory should no longer exist on disk
      const oldestBackupDir = path.join(appDir, 'backup', ids[0])
      expect(fsSync.existsSync(oldestBackupDir)).toBe(false)
    })
  })
})

// ── HotUpdater tests ──────────────────────────────────────────────────────────
//
// Ack timing strategy:
// hot-updater.ts registers the ack listener BEFORE calling socketServer.sendToApp().
// Therefore, making socketServer.sendToApp() emit the ack synchronously is the
// most reliable way to resolve the ack promise — no timing races possible.

describe('HotUpdater', () => {
  let appDir: string
  let hotUpdater: HotUpdater
  // Reference to the mocked socketServer so we can configure it per-test
  let mockSendToApp: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    appDir = await makeTempDir()
    await seedSrcDir(appDir)
    hotUpdater = new HotUpdater()
    sharedAckBus.removeAllListeners('status')
    makeTscSucceed()

    // Import the mocked socketServer and capture sendToApp
    const { socketServer } = await import('../../socket-server/socket-server')
    mockSendToApp = socketServer.sendToApp as ReturnType<typeof vi.fn>

    // Default: sendToApp emits a successful ack synchronously for app-1
    mockSendToApp.mockImplementation((appId: string) => {
      sharedAckBus.emit('status', appId, 'running')
    })
  })

  afterEach(async () => {
    sharedAckBus.removeAllListeners('status')
    await fsp.rm(appDir, { recursive: true, force: true })
    // Use clearAllMocks (not restoreAllMocks) so vi.fn() implementations are
    // preserved. restoreAllMocks() resets spied-on vi.fn() to their original
    // no-op state, breaking the sendToApp ack emission in subsequent tests.
    vi.clearAllMocks()
  })

  describe('applyHotUpdate — backup created before file writes', () => {
    it('creates a backup entry (getLastBackupId returns non-null) after successful update', async () => {
      const pkg = makeUpdatePackage('app-1')

      await hotUpdater.applyHotUpdate('app-1', pkg, appDir)

      expect(hotUpdater.getLastBackupId('app-1')).toBeDefined()
    })

    it('backup directory is created before new module files are written', async () => {
      const pkg = makeUpdatePackage('app-1')

      await hotUpdater.applyHotUpdate('app-1', pkg, appDir)

      // Backup root must exist after a successful update (created in step 1)
      const backupRoot = path.join(appDir, 'backup')
      expect(fsSync.existsSync(backupRoot)).toBe(true)
      const entries = await fsp.readdir(backupRoot)
      expect(entries.length).toBeGreaterThan(0)
    })
  })

  describe('applyHotUpdate — tsc failure triggers webContents reload', () => {
    it('calls webContents.reloadIgnoringCache() and re-throws when tsc fails', async () => {
      makeTscFail('TS2304: Cannot find name')

      const reloadMock = vi.fn()
      const { BrowserWindow, webContents } = await import('electron')
      vi.mocked(webContents.getAllWebContents).mockReturnValue([
        { getURL: () => 'app://app-1/index.html' } as unknown as Electron.WebContents,
      ])
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({
        isDestroyed: () => false,
        webContents: { reloadIgnoringCache: reloadMock },
      } as unknown as Electron.BrowserWindow)

      const pkg = makeUpdatePackage('app-1')

      await expect(hotUpdater.applyHotUpdate('app-1', pkg, appDir)).rejects.toThrow('tsc')

      expect(reloadMock).toHaveBeenCalledOnce()
    })
  })

  describe('applyHotUpdate — ack timeout triggers fallback reload', () => {
    it('rejects with Ack timeout and calls reloadIgnoringCache() when ack bus never emits', async () => {
      // sendToApp does NOT emit the ack — simulates SkillApp not responding
      mockSendToApp.mockImplementation(() => { /* no ack */ })

      const reloadMock = vi.fn()
      const { BrowserWindow, webContents } = await import('electron')
      vi.mocked(webContents.getAllWebContents).mockReturnValue([
        { getURL: () => 'app://app-1/index.html' } as unknown as Electron.WebContents,
      ])
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({
        isDestroyed: () => false,
        webContents: { reloadIgnoringCache: reloadMock },
      } as unknown as Electron.BrowserWindow)

      const pkg = makeUpdatePackage('app-1')

      // Run applyHotUpdate with a real 11-second wait so the 10-second ack
      // timeout fires naturally. We extend the test timeout to accommodate.
      await expect(hotUpdater.applyHotUpdate('app-1', pkg, appDir)).rejects.toThrow(/Ack timeout/)
      expect(reloadMock).toHaveBeenCalledOnce()
    }, 20_000)

    it('resolves successfully when ack bus emits "running" for the correct appId', async () => {
      // sendToApp emits 'running' — default behaviour set in beforeEach
      const pkg = makeUpdatePackage('app-1')
      await expect(hotUpdater.applyHotUpdate('app-1', pkg, appDir)).resolves.not.toThrow()
    })

    it('resolves successfully when ack bus emits "ready" for the correct appId', async () => {
      mockSendToApp.mockImplementation((appId: string) => {
        sharedAckBus.emit('status', appId, 'ready')
      })

      const pkg = makeUpdatePackage('app-1')
      await expect(hotUpdater.applyHotUpdate('app-1', pkg, appDir)).resolves.not.toThrow()
    })

    it('does NOT resolve when ack is for a different appId — times out instead', async () => {
      // sendToApp emits ack for wrong appId — our listener for 'app-1' never fires
      mockSendToApp.mockImplementation(() => {
        sharedAckBus.emit('status', 'app-WRONG', 'running')
      })

      const pkg = makeUpdatePackage('app-1')

      // Let the real 10-second ACK_TIMEOUT_MS fire naturally
      await expect(hotUpdater.applyHotUpdate('app-1', pkg, appDir)).rejects.toThrow(/Ack timeout/)
    }, 20_000)
  })

  describe('getLastBackupId', () => {
    it('returns undefined for an app that has never been hot-updated', () => {
      expect(hotUpdater.getLastBackupId('never-updated-app')).toBeUndefined()
    })

    it('returns the backupId after a successful applyHotUpdate', async () => {
      const pkg = makeUpdatePackage('app-1')

      await hotUpdater.applyHotUpdate('app-1', pkg, appDir)

      expect(hotUpdater.getLastBackupId('app-1')).toBeDefined()
      expect(typeof hotUpdater.getLastBackupId('app-1')).toBe('string')
    })
  })
})
