/**
 * Unit tests for @intentos/skillapp-runtime M-06 handshake timing
 *
 * Strategy:
 * - electron (ipcMain) is vi.mock'd — the runtime registers ipcMain handlers
 *   during initialize(); the mock prevents crashes in a non-Electron env.
 * - net.createConnection is vi.mock'd to return a controllable fake socket
 *   (EventEmitter + writable-like interface).
 * - vi.useFakeTimers() controls the 15s handshake timeout and 30s heartbeat
 *   interval so tests run in microseconds.
 * - process.exit is stubbed to prevent the test process from actually exiting.
 * - Each test resets the runtime module singleton by re-importing the module
 *   via vi.resetModules().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'

// ── Fake socket factory ───────────────────────────────────────────────────────

class FakeSocket extends EventEmitter {
  destroyed = false
  writable = true
  written: string[] = []

  write(data: string, cb?: (err?: Error | null) => void): boolean {
    if (!this.destroyed) {
      this.written.push(data)
    }
    cb?.()
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.writable = false
    this.emit('close')
  }

  setEncoding(_enc: string): this {
    return this
  }
}

let fakeSocket: FakeSocket

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net')>()
  return {
    ...actual,
    createConnection: vi.fn((_path: string) => {
      // Each call returns the current fakeSocket; emit 'connect' on next tick
      process.nextTick(() => fakeSocket.emit('connect'))
      return fakeSocket
    }),
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse the most recent JSON-RPC message written to the fake socket.
 * Strips trailing newline and parses.
 */
function lastWritten(socket: FakeSocket): Record<string, unknown> | null {
  if (socket.written.length === 0) return null
  const raw = socket.written[socket.written.length - 1].trim()
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Send a fake JSON-RPC response back through the socket as if it came from
 * the Desktop — simulates the Desktop server replying to a pending request.
 */
function replyToLastRequest(
  socket: FakeSocket,
  result: unknown,
): void {
  const msg = lastWritten(socket)
  if (!msg) throw new Error('No messages written to socket')
  const id = msg['id'] as string
  const response = JSON.stringify({
    jsonrpc: '2.0',
    result,
    id,
  })
  socket.emit('data', Buffer.from(response + '\n'))
}

// ── Test setup ────────────────────────────────────────────────────────────────

let processExitSpy: ReturnType<typeof vi.spyOn>
let processSendSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()

  // Create a fresh socket for each test
  fakeSocket = new FakeSocket()

  // Prevent real process exit
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
    throw new Error(`process.exit(${_code ?? ''})`)
  })

  // Spy on process.send (IPC to parent spawner)
  if (!process.send) {
    // In test environment process.send may not exist — add a stub
    ;(process as NodeJS.Process & { send: unknown }).send = vi.fn()
  }
  processSendSpy = vi.spyOn(process, 'send' as never).mockImplementation(vi.fn() as never)

  process.env['INTENTOS_APP_ID'] = 'test-skill-app'
  process.env['INTENTOS_IPC_PATH'] = '/tmp/test.sock'
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env['INTENTOS_APP_ID']
  delete process.env['INTENTOS_IPC_PATH']
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('skillapp-runtime handshake timing', () => {
  // ── Handshake timeout ──────────────────────────────────────────────────────

  describe('handshake timeout', () => {
    it('calls process.exit(1) when no handshake response arrives within 15s', async () => {
      const { initRuntime } = await import('../main.js')

      // Start init but do NOT reply to the handshake request
      const initPromise = initRuntime({
        appId: 'test-skill-app',
        ipcPath: '/tmp/test.sock',
        handshakeTimeout: 15_000,
      }).catch((err: unknown) => err)

      // Let connect event fire
      await vi.advanceTimersByTimeAsync(0)

      // Advance past handshake timeout
      await vi.advanceTimersByTimeAsync(15_001)

      const err = await initPromise
      expect(err).toBeInstanceOf(Error)
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ── Successful handshake ───────────────────────────────────────────────────

  describe('successful handshake', () => {
    it('resolves initRuntime() when Desktop replies to handshake', async () => {
      const { initRuntime } = await import('../main.js')

      const initPromise = initRuntime({
        appId: 'test-skill-app',
        ipcPath: '/tmp/test.sock',
        handshakeTimeout: 15_000,
      })

      // Let connect event fire
      await vi.advanceTimersByTimeAsync(0)

      // Reply to the handshake request
      replyToLastRequest(fakeSocket, {
        permissions: [],
        config: {
          heartbeatInterval: 30_000,
          skillCallTimeout: 10_000,
          resourceAccessTimeout: 10_000,
        },
      })

      // Allow microtasks to process
      await vi.advanceTimersByTimeAsync(0)

      await expect(initPromise).resolves.toBeUndefined()
    })

    it('sends process.send({ type: "ready", appId }) after successful handshake', async () => {
      const { initRuntime } = await import('../main.js')

      const initPromise = initRuntime({
        appId: 'test-skill-app',
        ipcPath: '/tmp/test.sock',
        handshakeTimeout: 15_000,
      })

      await vi.advanceTimersByTimeAsync(0)

      replyToLastRequest(fakeSocket, {
        permissions: [],
        config: {},
      })

      await vi.advanceTimersByTimeAsync(0)
      await initPromise

      expect(processSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ready', appId: 'test-skill-app' })
      )
    })

    it('sends a handshake JSON-RPC request to the socket with correct method', async () => {
      const { initRuntime } = await import('../main.js')

      const initPromise = initRuntime({
        appId: 'test-skill-app',
        ipcPath: '/tmp/test.sock',
        handshakeTimeout: 15_000,
      })

      await vi.advanceTimersByTimeAsync(0)

      // Verify that a handshake message was written before replying
      const written = fakeSocket.written
      expect(written.length).toBeGreaterThan(0)
      const handshakeMsg = JSON.parse(written[0].trim()) as Record<string, unknown>
      expect(handshakeMsg['method']).toBe('handshake')
      expect((handshakeMsg['params'] as Record<string, unknown>)['appId']).toBe('test-skill-app')

      // Now reply so initRuntime doesn't hang
      replyToLastRequest(fakeSocket, { permissions: [], config: {} })
      await vi.advanceTimersByTimeAsync(0)
      await initPromise
    })
  })

  // ── Heartbeat after handshake ─────────────────────────────────────────────

  describe('heartbeat', () => {
    it('sends a heartbeat notification 30s after handshake completes', async () => {
      const { initRuntime } = await import('../main.js')

      const initPromise = initRuntime({
        appId: 'test-skill-app',
        ipcPath: '/tmp/test.sock',
        handshakeTimeout: 15_000,
        heartbeatInterval: 30_000,
      })

      await vi.advanceTimersByTimeAsync(0)
      replyToLastRequest(fakeSocket, {
        permissions: [],
        config: { heartbeatInterval: 30_000 },
      })
      await vi.advanceTimersByTimeAsync(0)
      await initPromise

      // Record message count right after init
      const countAfterInit = fakeSocket.written.length

      // Advance 30s — heartbeat interval
      await vi.advanceTimersByTimeAsync(30_000)

      // At least one new message should have been written
      expect(fakeSocket.written.length).toBeGreaterThan(countAfterInit)

      // Find any heartbeat notification among the newly written messages
      const newMessages = fakeSocket.written
        .slice(countAfterInit)
        .map((raw) => {
          try {
            return JSON.parse(raw.trim()) as Record<string, unknown>
          } catch {
            return null
          }
        })
        .filter(Boolean)

      const heartbeat = newMessages.find(
        (m) => m !== null && m['method'] === 'heartbeat'
      )
      expect(heartbeat).toBeDefined()
      expect((heartbeat!['params'] as Record<string, unknown>)['appId']).toBe('test-skill-app')
    })
  })
})
