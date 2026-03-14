/**
 * mcp-proxy — public API surface
 *
 * Re-exports MCPProxy class, the module singleton, and resource request/response
 * types so callers only need one import path.
 */

export { MCPProxy } from './mcp-proxy'
export type {
  ResourceAccessRequest,
  ResourceAccessResponse,
  FsAccessRequest,
  NetAccessRequest,
  ProcessAccessRequest,
} from './mcp-proxy'

import { MCPProxy } from './mcp-proxy'

/**
 * Module-level singleton with an empty process allow-list.
 * Pass an explicit allowedCommands array to MCPProxy constructor when
 * process execution needs to be authorised for specific commands.
 */
export const mcpProxy = new MCPProxy()
