/**
 * Unit / integration tests for SocketServer (M-05)
 *
 * Strategy:
 * - Spin up a real net.Server on a temporary socket path per test.
 * - Connect real net.createConnection clients so the framing, routing, and
 *   session lifecycle code runs end-to-end without mocking the transport.
 * - electron is mocked so `app.getPath` does not crash in a non-Electron env.
 * - Each test creates a fresh SocketServer to guarantee session isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'

// ── Mocks — must be declared before importing the module under test ────────────

const tmpSocketDir = path.join(os.tmpdir(), `intentos-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpSocketDir),
  },
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { SocketServer } from '../socket-server'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write a newline-delimited JSON-RPC message to a socket and collect the
 * first complete newline-terminated response line.
 */
function sendAndReceive(
  socket: net.Socket,
  message: object,
): Promise<object> {
  return new Promise((resolve, reject) => {
    let buf = ''

    const onData = (chunk: Buffer | string): void => {
      buf += chunk.toString()
      const idx = buf.indexOf('\n')
      if (idx !== -1) {
        socket.off('data', onData)
        try {
          resolve(JSON.parse(buf.slice(0, idx)))
        } catch (e) {
          reject(e)
        }
      }
    }

    socket.on('data', onData)
    socket.write(JSON.stringify(message) + '\n')
  })
}

/**
 * Collect all newline-delimited JSON lines arriving within `waitMs` ms.
 */
function collectMessages(socket: net.Socket, waitMs = 200): Promise<object[]> {
  return new Promise((resolve) => {
    const results: object[] = []
    let buf = ''

    const onData = (chunk: Buffer | string): void => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          try {
            results.push(JSON.parse(trimmed))
          } catch {
            // ignore malformed lines in collector
          }
        }
      }
    }

    socket.on('data', onData)
    setTimeout(() => {
      socket.off('data', onData)
      resolve(results)
    }, waitMs)
  })
}

/**
 * Open a client socket connected to the given sock path and wait for the
 * 'connect' event before returning.
 */
function connectClient(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath)
    sock.once('connect', () => resolve(sock))
    sock.once('error', reject)
  })
}

// ── Test setup ────────────────────────────────────────────────────────────────

let server: SocketServer
let sockPath1: string
let sockPath2: string

beforeEach(async () => {
  await fs.mkdir(tmpSocketDir, { recursive: true })
  server = new SocketServer()
  await server.start()
  sockPath1 = await server.createAppSocket('app-1')
  sockPath2 = await server.createAppSocket('app-2')
})

afterEach(async () => {
  await server.stop()
  // clean up socket files
  try {
    await fs.rm(tmpSocketDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SocketServer', () => {
  // ── Concurrent routing isolation ──────────────────────────────────────────

  describe('concurrent routing isolation', () => {
    it('routes skill.call responses to the correct app without cross-talk', async () => {
      // Register a handler that echoes the appId from the session
      server.registerHandler('skill.call', async (_params, session) => {
        return { echoAppId: session.appId }
      })

      const client1 = await connectClient(sockPath1)
      const client2 = await connectClient(sockPath2)

      try {
        // Send concurrent requests from both clients
        const [resp1, resp2] = await Promise.all([
          sendAndReceive(client1, {
            jsonrpc: '2.0',
            method: 'skill.call',
            params: {},
            id: 100,
          }),
          sendAndReceive(client2, {
            jsonrpc: '2.0',
            method: 'skill.call',
            params: {},
            id: 200,
          }),
        ])

        // app-1 client should receive its own session's appId
        expect((resp1 as { result: { echoAppId: string } }).result.echoAppId).toBe('app-1')
        expect((resp1 as { id: number }).id).toBe(100)

        // app-2 client should receive its own session's appId — no cross-routing
        expect((resp2 as { result: { echoAppId: string } }).result.echoAppId).toBe('app-2')
        expect((resp2 as { id: number }).id).toBe(200)
      } finally {
        client1.destroy()
        client2.destroy()
      }
    })
  })

  // ── Packet coalescing (sticky-packet) handling ─────────────────────────────

  describe('sticky-packet framing', () => {
    it('parses two messages written in one TCP chunk separated by newline', async () => {
      server.registerHandler('skill.call', async (_params, _session) => {
        return { ok: true }
      })

      const client = await connectClient(sockPath1)

      try {
        const msg1 = JSON.stringify({ jsonrpc: '2.0', method: 'skill.call', params: {}, id: 1 })
        const msg2 = JSON.stringify({ jsonrpc: '2.0', method: 'skill.call', params: {}, id: 2 })

        // Write both messages as a single chunk — simulates TCP coalescing
        const collector = collectMessages(client, 300)
        client.write(msg1 + '\n' + msg2 + '\n')

        const responses = await collector

        // Both messages must have been parsed and replied to
        expect(responses).toHaveLength(2)
        const ids = responses.map((r) => (r as { id: number }).id).sort()
        expect(ids).toEqual([1, 2])
      } finally {
        client.destroy()
      }
    })
  })

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    it("responds with { result: { alive: true } } when heartbeat handler is registered", async () => {
      // Override the built-in heartbeat stub with one that returns alive:true
      server.registerHandler('heartbeat', async (_params, _session) => {
        return { alive: true }
      })

      const client = await connectClient(sockPath1)

      try {
        const response = await sendAndReceive(client, {
          jsonrpc: '2.0',
          method: 'heartbeat',
          params: {},
          id: 42,
        })

        expect((response as { result: { alive: boolean } }).result.alive).toBe(true)
      } finally {
        client.destroy()
      }
    })

    it('built-in heartbeat handler responds with a timestamp and appId', async () => {
      const client = await connectClient(sockPath1)

      try {
        const response = await sendAndReceive(client, {
          jsonrpc: '2.0',
          method: 'heartbeat',
          params: {},
          id: 43,
        })

        const result = (response as { result: Record<string, unknown> }).result
        expect(typeof result['timestamp']).toBe('number')
        expect(result['appId']).toBe('app-1')
      } finally {
        client.destroy()
      }
    })
  })

  // ── Session cleanup on disconnect ──────────────────────────────────────────

  describe('session cleanup', () => {
    it('removes the session from SessionManager when the socket disconnects', async () => {
      const client = await connectClient(sockPath1)

      // Verify session was registered
      expect(server.getConnectedApps()).toContain('app-1')

      // Close client socket and wait for the close event to propagate
      await new Promise<void>((resolve) => {
        client.once('close', () => resolve())
        client.destroy()
      })

      // Allow the close event to propagate through the net stack and the
      // SocketServer 'close' handler to run (uses setImmediate-level timing)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))

      // Session must have been removed
      expect(server.getConnectedApps()).not.toContain('app-1')
    })
  })

  // ── sendToApp notification ─────────────────────────────────────────────────

  describe('sendToApp', () => {
    it('delivers a JSON-RPC notification to the target app socket', async () => {
      const client = await connectClient(sockPath1)

      try {
        // Start collecting notifications before calling sendToApp
        const collector = collectMessages(client, 300)

        server.sendToApp('app-1', 'test.notification', { payload: 'hello' })

        const messages = await collector

        expect(messages).toHaveLength(1)
        const msg = messages[0] as {
          jsonrpc: string
          method: string
          params: { payload: string }
        }
        expect(msg.jsonrpc).toBe('2.0')
        expect(msg.method).toBe('test.notification')
        expect(msg.params.payload).toBe('hello')
      } finally {
        client.destroy()
      }
    })

    it('does not throw when sending to an app with no active session', () => {
      // 'app-99' was never connected — should warn but not throw
      expect(() => {
        server.sendToApp('app-99', 'test.notification', {})
      }).not.toThrow()
    })
  })
})
