/**
 * socket-server — SessionManager
 *
 * Maintains a Map<appId, SocketSession> for all connected SkillApps.
 * Handles concurrent session isolation, request/response matching,
 * and timeout cleanup for pending requests.
 */

import type * as net from 'net'
import type { SocketSession, PendingRequest, JsonRpcErrorObject } from './types'

export class SessionManager {
  private readonly sessions = new Map<string, SocketSession>()

  // ── Session lifecycle ────────────────────────────────────────────────────────

  /**
   * Register a new session for an appId with the given socket.
   * If a session already exists for this appId it is destroyed first.
   */
  addSession(appId: string, socket: net.Socket): SocketSession {
    if (this.sessions.has(appId)) {
      this.destroySession(appId)
    }

    const session: SocketSession = {
      appId,
      socket,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      pendingRequests: new Map(),
      buffer: '',
    }

    this.sessions.set(appId, session)
    return session
  }

  /**
   * Remove and clean up the session for an appId.
   * All pending requests are rejected with APP_NOT_CONNECTED.
   */
  destroySession(appId: string): void {
    const session = this.sessions.get(appId)
    if (!session) return

    // Reject every pending request
    for (const [id, pending] of session.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.rejecter(
        new Error(`Session destroyed for appId=${appId}, requestId=${String(id)}`)
      )
    }
    session.pendingRequests.clear()

    // Close the socket if still open
    if (!session.socket.destroyed) {
      session.socket.destroy()
    }

    this.sessions.delete(appId)
  }

  /**
   * Return the session for an appId, or undefined if not connected.
   */
  getSession(appId: string): SocketSession | undefined {
    return this.sessions.get(appId)
  }

  /**
   * Return all currently active appIds.
   */
  listActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  // ── Pending request tracking ─────────────────────────────────────────────────

  /**
   * Register a pending outbound request and return a Promise that resolves
   * (or rejects) when the matching response arrives or the timeout fires.
   *
   * @param appId      Target SkillApp
   * @param id         JSON-RPC request id
   * @param timeoutMs  Maximum wait in milliseconds
   */
  waitForResponse(
    appId: string,
    id: string | number,
    timeoutMs: number
  ): Promise<unknown> {
    const session = this.sessions.get(appId)
    if (!session) {
      return Promise.reject(
        new Error(`No active session for appId=${appId}`)
      )
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        session.pendingRequests.delete(id)
        reject(new Error(`Request ${String(id)} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const entry: PendingRequest = {
        resolver: resolve,
        rejecter: reject,
        timeout: timeoutHandle,
      }

      session.pendingRequests.set(id, entry)
    })
  }

  /**
   * Resolve (or reject) a pending request when a response arrives.
   *
   * @param appId   The SkillApp that sent the response
   * @param id      JSON-RPC id from the response
   * @param result  Successful result value (if no error)
   * @param error   Error object (if the response contained an error)
   */
  resolveResponse(
    appId: string,
    id: string | number,
    result?: unknown,
    error?: JsonRpcErrorObject
  ): void {
    const session = this.sessions.get(appId)
    if (!session) return

    const entry = session.pendingRequests.get(id)
    if (!entry) return

    clearTimeout(entry.timeout)
    session.pendingRequests.delete(id)

    if (error !== undefined) {
      entry.rejecter(new Error(`RPC error ${error.code}: ${error.message}`))
    } else {
      entry.resolver(result)
    }
  }

  /**
   * Update the last heartbeat timestamp for an appId.
   */
  touchHeartbeat(appId: string): void {
    const session = this.sessions.get(appId)
    if (session) {
      session.lastHeartbeat = Date.now()
    }
  }
}
