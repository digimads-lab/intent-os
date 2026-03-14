/**
 * Unit tests for ModifySessionManager (M-05 — 增量修改会话)
 *
 * Strategy:
 * - vi.mock('fs') overrides the default `fs` import used by modify-session.ts.
 *   The mock makes fs.promises.access() resolve (app dir exists) by default,
 *   and readdir() return an empty list (no existing source files).
 * - AIProvider.planApp is a vi.fn() returning an async generator that
 *   produces PlanChunk objects ending with a 'complete' chunk.
 * - Each test creates a fresh ModifySessionManager; dispose() is called in
 *   afterEach to clear the cleanup interval timer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { WebContents } from 'electron'

// ── Electron mock (must precede source imports) ───────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-intentos') },
}))

// ── fs mock ───────────────────────────────────────────────────────────────────
// modify-session.ts uses `import fs from "fs"` (default import).
// We mock the whole "fs" module and expose mutable spy references so individual
// tests can override them with mockRejectedValueOnce / mockResolvedValue.

const mockAccess = vi.fn().mockResolvedValue(undefined)
const mockReaddir = vi.fn().mockResolvedValue([])
const mockReadFile = vi.fn().mockResolvedValue('')
const mockExistsSync = vi.fn().mockReturnValue(false)

vi.mock('fs', () => {
  return {
    default: {
      promises: {
        access: (...args: unknown[]) => mockAccess(...args),
        readdir: (...args: unknown[]) => mockReaddir(...args),
        readFile: (...args: unknown[]) => mockReadFile(...args),
      },
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
    },
    promises: {
      access: (...args: unknown[]) => mockAccess(...args),
      readdir: (...args: unknown[]) => mockReaddir(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  }
})

// ── Module under test ─────────────────────────────────────────────────────────

import { ModifySessionManager } from '../modify-session'
import { GeneratorError } from '../types'
import type { AIProvider } from '../../ai-provider/interfaces'
import type { PlanChunk, PlanResult } from '@intentos/shared-types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid PlanResult */
function makePlanResult(appName = 'Test App'): PlanResult {
  return {
    appName,
    description: 'A test app',
    modules: [
      { name: 'Main', filePath: 'src/app/main.tsx', description: 'Main module' },
    ],
    skillUsage: [],
  }
}

/**
 * Async generator yielding a planning chunk then a complete chunk with planResult.
 */
async function* makePlanStream(
  sessionId: string,
  planResult: PlanResult = makePlanResult(),
): AsyncGenerator<PlanChunk> {
  yield {
    sessionId,
    phase: 'planning',
    content: 'thinking…',
    planResult: undefined,
  }
  yield {
    sessionId,
    phase: 'complete',
    content: '',
    planResult,
  }
}

/** Build a mock AIProvider whose planApp returns a fresh stream per call. */
function makeAIProvider(): AIProvider & { planApp: MockInstance } {
  const provider = {
    id: 'mock',
    name: 'Mock Provider',
    status: 'ready' as const,
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    planApp: vi.fn().mockImplementation((req: { sessionId: string }) =>
      makePlanStream(req.sessionId),
    ),
    generateCode: vi.fn(),
    executeSkill: vi.fn(),
    cancelSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as AIProvider & { planApp: MockInstance }
  return provider
}

/** Build a mock WebContents sender. */
function makeSender(): WebContents & { send: MockInstance } {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  } as unknown as WebContents & { send: MockInstance }
}

/** Flush the microtask queue so fire-and-forget async streams complete. */
const flushAsync = (ms = 20) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ModifySessionManager', () => {
  let provider: AIProvider & { planApp: MockInstance }
  let manager: ModifySessionManager
  const APP_DIR = '/tmp/test-app'
  const APP_ID = 'app-1'

  beforeEach(() => {
    // Reset fs mocks to default (dir exists, no files)
    mockAccess.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
    mockReadFile.mockResolvedValue('')
    mockExistsSync.mockReturnValue(false)

    provider = makeAIProvider()
    manager = new ModifySessionManager(provider, async () => APP_DIR)
  })

  afterEach(() => {
    manager.dispose()
    vi.restoreAllMocks()
  })

  // ── startModifySession — basic behaviour ────────────────────────────────────

  describe('startModifySession', () => {
    it('returns a non-empty sessionId string', async () => {
      const { sessionId } = await manager.startModifySession(APP_ID, 'add dark mode')
      expect(typeof sessionId).toBe('string')
      expect(sessionId.length).toBeGreaterThan(0)
    })

    it('calls AIProvider.planApp with the user requirement as intent', async () => {
      const capturedRequests: Array<{ intent: string }> = []
      provider.planApp.mockImplementation((req: { sessionId: string; intent: string }) => {
        capturedRequests.push({ intent: req.intent })
        return makePlanStream(req.sessionId)
      })

      await manager.startModifySession(APP_ID, 'add export button')
      await flushAsync()

      expect(provider.planApp).toHaveBeenCalledOnce()
      expect(capturedRequests[0].intent).toBe('add export button')
    })

    it('sends plan-chunk IPC messages to the sender during planning', async () => {
      const sender = makeSender()
      await manager.startModifySession(APP_ID, 'add chart', sender)
      await flushAsync()

      expect(sender.send).toHaveBeenCalled()
    })

    it('sends modification:plan-complete IPC with the ModifyPlan after stream finishes', async () => {
      const sender = makeSender()
      const { sessionId } = await manager.startModifySession(APP_ID, 'add auth', sender)
      await flushAsync()

      const completeCalls = (sender.send as MockInstance).mock.calls.filter(
        (args: unknown[]) =>
          typeof args[0] === 'string' &&
          args[0] === `modification:plan-complete:${sessionId}`,
      )
      expect(completeCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('throws APP_DIR_NOT_FOUND when appDir does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'))

      await expect(
        manager.startModifySession('bad-app', 'anything'),
      ).rejects.toMatchObject({ code: 'APP_DIR_NOT_FOUND' })
    })
  })

  // ── classify AI output into added / modified / unchanged ───────────────────

  describe('ModifyPlan classification', () => {
    it('classifies a module as "added" when its filePath is NOT in existing files', async () => {
      // readdir returns empty → no existing files
      mockReaddir.mockResolvedValue([])

      const planResult: PlanResult = {
        appName: 'App',
        description: '',
        modules: [
          { name: 'New', filePath: 'src/app/new-feature.tsx', description: 'New feature' },
        ],
        skillUsage: [],
      }
      provider.planApp.mockImplementation((req: { sessionId: string }) =>
        makePlanStream(req.sessionId, planResult),
      )

      const { sessionId } = await manager.startModifySession(APP_ID, 'new feature')
      await flushAsync()

      const plan = manager.getModifySession(sessionId)
      expect(plan).not.toBeNull()
      expect(plan!.added.map(m => m.filePath)).toContain('src/app/new-feature.tsx')
      expect(plan!.modified).toHaveLength(0)
    })

    it('classifies a module as "modified" when its filePath IS in existing files', async () => {
      // Simulate one existing file in src/app/
      const mockDirent = {
        name: 'existing.tsx',
        isDirectory: () => false,
        isFile: () => true,
      }
      mockReaddir.mockResolvedValue([mockDirent])

      const planResult: PlanResult = {
        appName: 'App',
        description: '',
        modules: [
          { name: 'Existing', filePath: 'src/app/existing.tsx', description: 'Update existing' },
        ],
        skillUsage: [],
      }
      provider.planApp.mockImplementation((req: { sessionId: string }) =>
        makePlanStream(req.sessionId, planResult),
      )

      const { sessionId } = await manager.startModifySession(APP_ID, 'update existing')
      await flushAsync()

      const plan = manager.getModifySession(sessionId)
      expect(plan).not.toBeNull()
      expect(plan!.modified.map(m => m.filePath)).toContain('src/app/existing.tsx')
      expect(plan!.added).toHaveLength(0)
    })

    it('classifies files not mentioned by AI as "unchanged"', async () => {
      // Two existing files; AI plan only touches page-a → page-b should be unchanged
      const mockDirents = [
        { name: 'page-a.tsx', isDirectory: () => false, isFile: () => true },
        { name: 'page-b.tsx', isDirectory: () => false, isFile: () => true },
      ]
      mockReaddir.mockResolvedValue(mockDirents)

      const planResult: PlanResult = {
        appName: 'App',
        description: '',
        modules: [
          { name: 'PageA', filePath: 'src/app/page-a.tsx', description: 'Modify A' },
        ],
        skillUsage: [],
      }
      provider.planApp.mockImplementation((req: { sessionId: string }) =>
        makePlanStream(req.sessionId, planResult),
      )

      const { sessionId } = await manager.startModifySession(APP_ID, 'update page A only')
      await flushAsync()

      const plan = manager.getModifySession(sessionId)
      expect(plan).not.toBeNull()
      expect(plan!.unchanged).toContain('src/app/page-b.tsx')
      expect(plan!.modified.map(m => m.filePath)).toContain('src/app/page-a.tsx')
    })

    it('does NOT call AIProvider.generateCode for unchanged modules', async () => {
      // AI plan returns empty modules → all existing files are unchanged
      const mockDirents = [
        { name: 'untouched.tsx', isDirectory: () => false, isFile: () => true },
      ]
      mockReaddir.mockResolvedValue(mockDirents)

      const planResult: PlanResult = {
        appName: 'App',
        description: '',
        modules: [], // no modules → untouched.tsx goes to unchanged
        skillUsage: [],
      }
      provider.planApp.mockImplementation((req: { sessionId: string }) =>
        makePlanStream(req.sessionId, planResult),
      )

      await manager.startModifySession(APP_ID, 'do nothing')
      await flushAsync()

      // generateCode must NEVER be called for unchanged modules
      expect(provider.generateCode).not.toHaveBeenCalled()
    })
  })

  // ── getModifySession ────────────────────────────────────────────────────────

  describe('getModifySession', () => {
    it('returns the ModifyPlan after planning completes', async () => {
      const { sessionId } = await manager.startModifySession(APP_ID, 'some requirement')
      await flushAsync()

      const plan = manager.getModifySession(sessionId)
      expect(plan).not.toBeNull()
      expect(plan).toHaveProperty('added')
      expect(plan).toHaveProperty('modified')
      expect(plan).toHaveProperty('unchanged')
    })

    it('returns null while planning is still in progress', async () => {
      // Create the blocking promise BEFORE the generator so finishPlanning is
      // assigned synchronously before the async generator suspends.
      let finishPlanning: (() => void) | null = null
      const blockingPromise = new Promise<void>(resolve => { finishPlanning = resolve })

      const hangingStream = async function* (req: { sessionId: string }): AsyncGenerator<PlanChunk> {
        yield { sessionId: req.sessionId, phase: 'planning' as const, content: 'thinking…' }
        await blockingPromise
        // never reaches complete chunk → modifyPlan stays null
      }
      provider.planApp.mockImplementationOnce((req: { sessionId: string }) => hangingStream(req))

      const { sessionId } = await manager.startModifySession(APP_ID, 'slow requirement')

      // modifyPlan not set yet — stream is blocked on blockingPromise
      const plan = manager.getModifySession(sessionId)
      expect(plan).toBeNull()

      // Unblock the stream so it can be GC'd cleanly
      finishPlanning!()
    })

    it('throws MODIFY_SESSION_NOT_FOUND for an unknown sessionId', () => {
      expect(() => manager.getModifySession('nonexistent-id')).toThrow(GeneratorError)
      expect(() => manager.getModifySession('nonexistent-id')).toThrowError(
        expect.objectContaining({ code: 'MODIFY_SESSION_NOT_FOUND' }),
      )
    })
  })

  // ── cancelModifySession ─────────────────────────────────────────────────────

  describe('cancelModifySession', () => {
    it('removes the session so getModifySession throws MODIFY_SESSION_NOT_FOUND', async () => {
      const { sessionId } = await manager.startModifySession(APP_ID, 'to be cancelled')

      manager.cancelModifySession(sessionId)

      expect(() => manager.getModifySession(sessionId)).toThrowError(
        expect.objectContaining({ code: 'MODIFY_SESSION_NOT_FOUND' }),
      )
    })

    it('calls aiProvider.cancelSession with the correct sessionId', async () => {
      const { sessionId } = await manager.startModifySession(APP_ID, 'cancel test')

      manager.cancelModifySession(sessionId)

      expect(provider.cancelSession).toHaveBeenCalledWith(sessionId)
    })

    it('is a no-op when called with a non-existent sessionId (does not throw)', () => {
      expect(() => manager.cancelModifySession('ghost-session')).not.toThrow()
    })
  })

  // ── session timeout ─────────────────────────────────────────────────────────

  describe('session timeout', () => {
    it('throws MODIFY_SESSION_EXPIRED when session exceeds 30 minutes of inactivity', async () => {
      vi.useFakeTimers()

      const timeoutManager = new ModifySessionManager(provider, async () => APP_DIR)

      try {
        const { sessionId } = await timeoutManager.startModifySession(APP_ID, 'timeout test')

        // Advance 31 minutes past the last activity
        vi.advanceTimersByTime(31 * 60 * 1000)

        expect(() => timeoutManager.getModifySession(sessionId)).toThrowError(
          expect.objectContaining({ code: 'MODIFY_SESSION_EXPIRED' }),
        )
      } finally {
        timeoutManager.dispose()
        vi.useRealTimers()
      }
    })

    it('cleanup timer removes sessions after 30+5 minutes idle so GeneratorError is thrown', async () => {
      vi.useFakeTimers()

      const timeoutManager = new ModifySessionManager(provider, async () => APP_DIR)

      try {
        const { sessionId } = await timeoutManager.startModifySession(APP_ID, 'cleanup test')

        // Advance past timeout (30 min) + one cleanup interval (5 min)
        vi.advanceTimersByTime(36 * 60 * 1000)

        // Session deleted by cleanup timer — throws GeneratorError
        expect(() => timeoutManager.getModifySession(sessionId)).toThrow(GeneratorError)
      } finally {
        timeoutManager.dispose()
        vi.useRealTimers()
      }
    })
  })
})
