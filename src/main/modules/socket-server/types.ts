/**
 * socket-server — shared type definitions
 *
 * JSON-RPC 2.0 types, session structures, error codes, and handler contracts
 * used across socket-server, rpc-dispatcher, and session-manager.
 */

import type * as net from 'net'

// ── JSON-RPC 2.0 wire types ────────────────────────────────────────────────────

/**
 * A valid JSON-RPC 2.0 request (SkillApp → Desktop).
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params: Record<string, unknown>
  id: string | number
}

/**
 * A JSON-RPC 2.0 success response (Desktop → SkillApp).
 */
export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  result: unknown
  id: string | number
}

/**
 * A JSON-RPC 2.0 error object embedded inside an error response.
 */
export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

/**
 * A JSON-RPC 2.0 error response (Desktop → SkillApp).
 */
export interface JsonRpcError {
  jsonrpc: '2.0'
  error: JsonRpcErrorObject
  id: string | number | null
}

/**
 * A JSON-RPC 2.0 notification — no `id`, no reply expected (Desktop → SkillApp).
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params: Record<string, unknown>
}

/** Union of all outbound message types */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

// ── Error codes ────────────────────────────────────────────────────────────────

/**
 * JSON-RPC 2.0 standard error codes plus IntentOS custom codes.
 */
export const RpcErrorCode = {
  // JSON-RPC 2.0 standard
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // IntentOS custom (-32000 ~ -32099)
  SKILL_NOT_FOUND: -32000,
  PERMISSION_DENIED: -32001,
  RESOURCE_NOT_FOUND: -32002,
  SKILL_CALL_TIMEOUT: -32003,
  APP_NOT_CONNECTED: -32004,
} as const

export type RpcErrorCode = (typeof RpcErrorCode)[keyof typeof RpcErrorCode]

// ── Handler types ──────────────────────────────────────────────────────────────

/**
 * An RPC method handler registered with RPCDispatcher.
 * Receives the parsed params and returns the result value (any serialisable).
 * Throw to signal an error; thrown Error.message is used as the error message.
 */
export type RpcHandler = (
  params: Record<string, unknown>,
  session: SocketSession
) => Promise<unknown>

// ── Session types ──────────────────────────────────────────────────────────────

/**
 * A pending request waiting for a response, keyed by request id.
 */
export interface PendingRequest {
  resolver: (value: unknown) => void
  rejecter: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * Represents a single connected SkillApp session.
 */
export interface SocketSession {
  /** The SkillApp's unique application ID */
  appId: string
  /** The underlying TCP/Unix socket */
  socket: net.Socket
  /** Unix epoch ms when the connection was established */
  connectedAt: number
  /** Unix epoch ms of the last received heartbeat */
  lastHeartbeat: number
  /** In-progress requests waiting for handler responses, keyed by request id */
  pendingRequests: Map<string | number, PendingRequest>
  /** Internal message buffer for newline-delimited framing */
  buffer: string
}

// ── Dispatch result ────────────────────────────────────────────────────────────

/**
 * Result returned by RPCDispatcher.dispatch().
 * Exactly one of `result` or `error` will be present.
 */
export interface RpcDispatchResult {
  result?: unknown
  error?: JsonRpcErrorObject
}
