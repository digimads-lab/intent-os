/**
 * socket-server — RPCDispatcher
 *
 * Registers JSON-RPC 2.0 method handlers and dispatches inbound requests
 * to the appropriate handler.  Built-in stubs are provided for all five
 * IntentOS methods; callers replace them by calling register() again after
 * construction.
 */

import type { JsonRpcRequest, RpcHandler, RpcDispatchResult, SocketSession } from './types'
import { RpcErrorCode } from './types'
import { hotUpdateAckBus } from '../hot-updater/ack-bus'

export class RPCDispatcher {
  private readonly handlers = new Map<string, RpcHandler>()

  constructor() {
    this.registerBuiltins()
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Register (or overwrite) a handler for a JSON-RPC method name.
   *
   * @param method  e.g. 'skill.call'
   * @param handler Async function receiving params and the active session
   */
  register(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler)
  }

  /**
   * Dispatch a JSON-RPC request to the registered handler.
   * Never throws — all errors are captured and returned as RpcDispatchResult.
   */
  async dispatch(
    request: JsonRpcRequest,
    session: SocketSession
  ): Promise<RpcDispatchResult> {
    const handler = this.handlers.get(request.method)

    if (!handler) {
      return {
        error: {
          code: RpcErrorCode.METHOD_NOT_FOUND,
          message: `Method not found: ${request.method}`,
        },
      }
    }

    try {
      const result = await handler(request.params, session)
      return { result }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err)
      const code =
        (err !== null && typeof err === 'object' && 'code' in err && typeof (err as Record<string, unknown>)['code'] === 'number')
          ? (err as Record<string, unknown>)['code'] as number
          : RpcErrorCode.INTERNAL_ERROR
      return {
        error: {
          code,
          message,
          data: { originalError: String(err) },
        },
      }
    }
  }

  /**
   * Return all currently registered method names (useful for introspection/tests).
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys())
  }

  // ── Built-in method stubs ────────────────────────────────────────────────────

  /**
   * Register default no-op stubs for all five IntentOS RPC methods.
   * These are replaced at runtime by the real handlers injected from
   * M-04 (skill.call), M-06 (resource.access), and M-03 (permission.request,
   * status.report).
   */
  private registerBuiltins(): void {
    // skill.call — replaced by M-04 AI Provider communication layer
    this.handlers.set('skill.call', async (_params, _session) => {
      throw new Error('skill.call handler not yet registered')
    })

    // resource.access — replaced by M-06 runtime proxy
    this.handlers.set('resource.access', async (_params, _session) => {
      throw new Error('resource.access handler not yet registered')
    })

    // permission.request — replaced by M-03 lifecycle manager
    this.handlers.set('permission.request', async (_params, _session) => {
      throw new Error('permission.request handler not yet registered')
    })

    // status.report — default handler emits on hotUpdateAckBus so HotUpdater
    // can detect when a SkillApp reports 'running' or 'ready' after a hot update.
    // M-03 lifecycle manager may replace this handler; if so, that handler must
    // also call hotUpdateAckBus.emit('status', session.appId, params['status']).
    this.handlers.set('status.report', async (params, session) => {
      const status = typeof params['status'] === 'string' ? params['status'] : ''
      hotUpdateAckBus.emit('status', session.appId, status)
      return {}
    })

    // heartbeat — built-in: respond with current Desktop timestamp
    this.handlers.set('heartbeat', async (_params, session) => {
      return { timestamp: Date.now(), appId: session.appId }
    })
  }
}
