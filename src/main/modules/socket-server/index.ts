/**
 * socket-server — public API surface
 *
 * Re-exports the SocketServer class, the module singleton, and all
 * shared types so callers only need one import path.
 */

export { SocketServer, socketServer } from './socket-server'
export { SessionManager } from './session-manager'
export { RPCDispatcher } from './rpc-dispatcher'

export type {
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcErrorObject,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcResponse,
  RpcHandler,
  RpcDispatchResult,
  SocketSession,
  PendingRequest,
} from './types'

export { RpcErrorCode } from './types'
