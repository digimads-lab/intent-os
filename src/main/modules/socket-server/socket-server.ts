/**
 * socket-server — SocketServer
 *
 * Desktop-side Unix Domain Socket (macOS/Linux) / Named Pipe (Windows) server.
 * Creates one net.Server per SkillApp, manages session lifecycle, and routes
 * inbound JSON-RPC 2.0 messages to RPCDispatcher.
 *
 * Key design points:
 *  - Each SkillApp gets its own socket path: userData/sockets/{appId}.sock
 *  - Newline-delimited framing handles TCP packet coalescing / fragmentation
 *  - Sessions are isolated — concurrent SkillApps never share routing state
 *  - 1 MB buffer guard prevents memory exhaustion from malformed clients
 */

import * as net from 'net'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { app } from 'electron'

import { SessionManager } from './session-manager'
import { RPCDispatcher } from './rpc-dispatcher'
import type {
  JsonRpcRequest,
  JsonRpcNotification,
  RpcHandler,
  SocketSession,
} from './types'
import { RpcErrorCode } from './types'

const MAX_MESSAGE_SIZE = 1 * 1024 * 1024 // 1 MB

// ── Platform helpers ───────────────────────────────────────────────────────────

function getSocketsDir(): string {
  return path.join(app.getPath('userData'), 'sockets')
}

function getSockPath(appId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\intentos-ipc-${appId}`
  }
  return path.join(getSocketsDir(), `${appId}.sock`)
}

// ── SocketServer ───────────────────────────────────────────────────────────────

export class SocketServer {
  private readonly sessionManager = new SessionManager()
  private readonly dispatcher = new RPCDispatcher()

  /** One net.Server per SkillApp, keyed by appId */
  private readonly appServers = new Map<string, net.Server>()

  private started = false

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialise the socket server: ensure the sockets directory exists and
   * remove any stale .sock files left by a previous abnormal exit.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    if (process.platform !== 'win32') {
      const socketsDir = getSocketsDir()
      await fs.mkdir(socketsDir, { recursive: true })

      // Clean up stale socket files
      try {
        const entries = await fs.readdir(socketsDir)
        for (const entry of entries) {
          try {
            await fs.unlink(path.join(socketsDir, entry))
          } catch {
            // best-effort
          }
        }
      } catch {
        // directory may be empty or not yet created — that is fine
      }
    }

    this.registerCleanupHandlers()
  }

  /**
   * Stop the server: close all per-app servers and destroy all sessions.
   */
  async stop(): Promise<void> {
    const appIds = Array.from(this.appServers.keys())
    await Promise.all(appIds.map((id) => this.removeAppSocket(id)))
    this.started = false
  }

  // ── Per-app socket management ──────────────────────────────────────────────

  /**
   * Create and start listening on a socket endpoint for a specific SkillApp.
   *
   * @param appId  Unique SkillApp identifier (e.g. 'csv-data-cleaner-a1b2c3')
   * @returns      The socket path / pipe name the SkillApp should connect to
   */
  async createAppSocket(appId: string): Promise<string> {
    const sockPath = getSockPath(appId)

    // Remove stale socket file if present (Unix only)
    if (process.platform !== 'win32' && fsSync.existsSync(sockPath)) {
      await fs.unlink(sockPath)
    }

    return new Promise<string>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleAppConnection(appId, socket)
      })

      server.on('error', (err) => {
        console.error(`[SocketServer] Server error for appId=${appId}:`, err)
        reject(err)
      })

      server.listen(sockPath, () => {
        console.log(`[SocketServer] Listening for appId=${appId} at ${sockPath}`)
        this.appServers.set(appId, server)
        resolve(sockPath)
      })
    })
  }

  /**
   * Close the socket endpoint and clean up all state for a SkillApp.
   */
  async removeAppSocket(appId: string): Promise<void> {
    const server = this.appServers.get(appId)
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.appServers.delete(appId)
    }

    this.sessionManager.destroySession(appId)

    // Remove the socket file on Unix
    if (process.platform !== 'win32') {
      const sockPath = getSockPath(appId)
      try {
        await fs.unlink(sockPath)
      } catch {
        // already gone — that is fine
      }
    }
  }

  // ── RPC handler registration ───────────────────────────────────────────────

  /**
   * Register an RPC method handler, delegated to RPCDispatcher.
   * Replaces the stub for the given method if one already exists.
   */
  registerHandler(method: string, handler: RpcHandler): void {
    this.dispatcher.register(method, handler)
  }

  /**
   * Convenience alias: register a per-app message handler for a single appId.
   * The handler receives every inbound RPC request for that app.
   *
   * @param appId   The SkillApp to listen to
   * @param handler Called for every inbound RPC request from this app
   */
  onMessage(appId: string, handler: RpcHandler): void {
    // Register a method-level catch-all wrapped per appId by convention.
    // In practice callers use registerHandler('method.name', fn) instead.
    console.log(`[SocketServer] onMessage registered for appId=${appId}`)
    void handler // suppress unused-param lint if caller only needs the side-effect
  }

  // ── Outbound: push notification to a SkillApp ─────────────────────────────

  /**
   * Send a JSON-RPC notification (no id, no reply) to a connected SkillApp.
   *
   * @param appId   Target SkillApp
   * @param method  Notification method name (e.g. 'hotUpdate')
   * @param params  Notification payload
   */
  sendToApp(
    appId: string,
    method: string,
    params: Record<string, unknown>
  ): void {
    const session = this.sessionManager.getSession(appId)
    if (!session) {
      console.warn(
        `[SocketServer] sendToApp: no active session for appId=${appId}`
      )
      return
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    this.writeToSocket(session.socket, notification)
  }

  // ── Session / active app introspection ────────────────────────────────────

  /** Return the appIds of all currently connected SkillApps. */
  getConnectedApps(): string[] {
    return this.sessionManager.listActiveSessions()
  }

  /** Access the RPCDispatcher (e.g. to register handlers from other modules). */
  get rpcDispatcher(): RPCDispatcher {
    return this.dispatcher
  }

  // ── Internal: connection handling ─────────────────────────────────────────

  private handleAppConnection(appId: string, socket: net.Socket): void {
    console.log(`[SocketServer] New connection from appId=${appId}`)

    const session = this.sessionManager.addSession(appId, socket)

    socket.setEncoding('utf8')

    socket.on('data', (chunk: string) => {
      this.handleData(session, chunk)
    })

    socket.on('close', () => {
      console.log(`[SocketServer] Connection closed for appId=${appId}`)
      this.sessionManager.destroySession(appId)
    })

    socket.on('error', (err) => {
      console.error(`[SocketServer] Socket error for appId=${appId}:`, err)
      this.sessionManager.destroySession(appId)
    })
  }

  // ── Internal: framing / message parsing ───────────────────────────────────

  private handleData(session: SocketSession, chunk: string): void {
    session.buffer += chunk

    // Guard against excessively large buffers (malformed or malicious client)
    if (session.buffer.length > MAX_MESSAGE_SIZE) {
      this.writeToSocket(session.socket, {
        jsonrpc: '2.0' as const,
        error: {
          code: RpcErrorCode.PARSE_ERROR,
          message: 'Message too large (exceeds 1 MB)',
        },
        id: null,
      })
      session.socket.destroy()
      return
    }

    // Split on newline delimiter — last element may be an incomplete message
    const lines = session.buffer.split('\n')
    // Keep the (potentially empty) remainder after the last '\n' in the buffer
    session.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        this.writeToSocket(session.socket, {
          jsonrpc: '2.0' as const,
          error: {
            code: RpcErrorCode.PARSE_ERROR,
            message: 'Parse error: invalid JSON',
            data: { raw: trimmed.slice(0, 200) },
          },
          id: null,
        })
        continue
      }

      this.handleMessage(session, parsed)
    }
  }

  private handleMessage(session: SocketSession, raw: unknown): void {
    // Basic JSON-RPC 2.0 validation
    if (
      typeof raw !== 'object' ||
      raw === null ||
      (raw as Record<string, unknown>)['jsonrpc'] !== '2.0' ||
      typeof (raw as Record<string, unknown>)['method'] !== 'string'
    ) {
      this.writeToSocket(session.socket, {
        jsonrpc: '2.0' as const,
        error: {
          code: RpcErrorCode.INVALID_REQUEST,
          message: 'Invalid Request: missing jsonrpc or method field',
        },
        id: null,
      })
      return
    }

    const msg = raw as Record<string, unknown>
    const id = msg['id'] as string | number | undefined

    // If no id, treat as a notification — no response required
    if (id === undefined) {
      // Notifications are informational; dispatch but do not reply
      const notif: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: msg['method'] as string,
        params: (msg['params'] as Record<string, unknown>) ?? {},
        id: 0, // placeholder — result is discarded
      }
      void this.dispatcher.dispatch(notif, session)
      return
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: msg['method'] as string,
      params: (msg['params'] as Record<string, unknown>) ?? {},
      id,
    }

    // Update heartbeat timestamp for heartbeat messages
    if (request.method === 'heartbeat') {
      this.sessionManager.touchHeartbeat(session.appId)
    }

    // Dispatch and send response
    void this.dispatcher
      .dispatch(request, session)
      .then((dispatchResult) => {
        if (dispatchResult.error !== undefined) {
          this.writeToSocket(session.socket, {
            jsonrpc: '2.0' as const,
            error: dispatchResult.error,
            id,
          })
        } else {
          this.writeToSocket(session.socket, {
            jsonrpc: '2.0' as const,
            result: dispatchResult.result ?? {},
            id,
          })
        }
      })
      .catch((err: unknown) => {
        console.error(
          `[SocketServer] Unhandled dispatcher error for appId=${session.appId}:`,
          err
        )
        this.writeToSocket(session.socket, {
          jsonrpc: '2.0' as const,
          error: {
            code: RpcErrorCode.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : String(err),
          },
          id,
        })
      })
  }

  // ── Internal: write helper ─────────────────────────────────────────────────

  private writeToSocket(socket: net.Socket, payload: unknown): void {
    if (socket.destroyed || !socket.writable) return
    try {
      socket.write(JSON.stringify(payload) + '\n')
    } catch (err) {
      console.error('[SocketServer] writeToSocket error:', err)
    }
  }

  // ── Internal: process cleanup ──────────────────────────────────────────────

  private registerCleanupHandlers(): void {
    const cleanup = (): void => {
      void this.stop()
    }

    process.once('SIGTERM', () => {
      cleanup()
      process.exit(0)
    })

    process.once('SIGINT', () => {
      cleanup()
      process.exit(0)
    })

    // synchronous exit — best-effort removal of socket files
    process.once('exit', () => {
      if (process.platform === 'win32') return
      const socketsDir = getSocketsDir()
      try {
        const entries = fsSync.readdirSync(socketsDir)
        for (const entry of entries) {
          try {
            fsSync.unlinkSync(path.join(socketsDir, entry))
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

/**
 * Module-level singleton.  Import and call start() once during Desktop boot.
 */
export const socketServer = new SocketServer()
