/**
 * mcp-proxy — MCPProxy
 *
 * Registers the `resource.access` JSON-RPC handler with SocketServer and
 * proxies three classes of resource request to native Node.js APIs:
 *
 *   fs      — file-system read / write / list  (sandboxed to userData)
 *   net     — HTTP / HTTPS fetch
 *   process — execFile against an explicit allow-list
 *
 * Security invariants enforced here:
 *   - fs paths must resolve inside app.getPath('userData') (no path traversal)
 *   - net URLs must use http: or https: scheme
 *   - process commands must appear in the configured allow-list (default: empty)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as childProcess from 'child_process'
import { app } from 'electron'

import type { SocketServer } from '../socket-server/socket-server'
import type { SocketSession } from '../socket-server/types'
import { RpcErrorCode } from '../socket-server/types'

// ── Request / response shapes ──────────────────────────────────────────────────

export interface FsAccessRequest {
  type: 'fs'
  operation: 'read' | 'write' | 'list'
  path: string
  content?: string
}

export interface NetAccessRequest {
  type: 'net'
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface ProcessAccessRequest {
  type: 'process'
  command: string
  args?: string[]
}

export type ResourceAccessRequest =
  | FsAccessRequest
  | NetAccessRequest
  | ProcessAccessRequest

export interface ResourceAccessResponse {
  data: unknown
}

// ── MCPProxy ───────────────────────────────────────────────────────────────────

export class MCPProxy {
  /** Commands allowed for process execution.  Empty by default — must be explicitly authorised. */
  private readonly allowedCommands: Set<string>

  constructor(allowedCommands: string[] = []) {
    this.allowedCommands = new Set(allowedCommands)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Register the `resource.access` handler with the given SocketServer.
   * Replaces any previously registered stub.
   */
  registerResourceHandler(socketServer: SocketServer): void {
    socketServer.registerHandler(
      'resource.access',
      async (
        params: Record<string, unknown>,
        session: SocketSession
      ): Promise<unknown> => {
        const request = params as unknown as ResourceAccessRequest
        return this.handleResourceAccess(session.appId, request)
      }
    )
  }

  // ── Internal: dispatch by type ───────────────────────────────────────────────

  private async handleResourceAccess(
    appId: string,
    request: ResourceAccessRequest
  ): Promise<ResourceAccessResponse> {
    switch (request.type) {
      case 'fs':
        return this.handleFs(appId, request)
      case 'net':
        return this.handleNet(request)
      case 'process':
        return this.handleProcess(request)
      default: {
        // exhaustive check — TypeScript will error if a new case is added without handling
        const _exhaustive: never = request
        throw permissionDenied(`Unknown resource type: ${String((_exhaustive as ResourceAccessRequest).type)}`)
      }
    }
  }

  // ── fs handler ───────────────────────────────────────────────────────────────

  private async handleFs(
    _appId: string,
    request: FsAccessRequest
  ): Promise<ResourceAccessResponse> {
    const sandboxRoot = app.getPath('userData')
    const resolved = path.resolve(request.path)

    // Prevent path traversal outside userData
    if (!resolved.startsWith(sandboxRoot + path.sep) && resolved !== sandboxRoot) {
      throw permissionDenied(
        `fs access denied: path must be inside userData (${sandboxRoot})`
      )
    }

    switch (request.operation) {
      case 'read': {
        const content = await fs.readFile(resolved, 'utf8')
        return { data: content }
      }
      case 'write': {
        if (request.content === undefined) {
          throw invalidParams('fs write requires content field')
        }
        await fs.writeFile(resolved, request.content, 'utf8')
        return { data: null }
      }
      case 'list': {
        const entries = await fs.readdir(resolved)
        return { data: entries }
      }
      default: {
        const _exhaustive: never = request.operation
        throw invalidParams(`Unknown fs operation: ${String(_exhaustive)}`)
      }
    }
  }

  // ── net handler ──────────────────────────────────────────────────────────────

  private async handleNet(
    request: NetAccessRequest
  ): Promise<ResourceAccessResponse> {
    let parsed: URL
    try {
      parsed = new URL(request.url)
    } catch {
      throw invalidParams(`net access denied: invalid URL: ${request.url}`)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw permissionDenied(
        `net access denied: only http/https allowed, got ${parsed.protocol}`
      )
    }

    const fetchInit: RequestInit = {
      method: request.method ?? 'GET',
    }
    if (request.headers !== undefined) {
      fetchInit.headers = request.headers
    }
    if (request.body !== undefined) {
      fetchInit.body = request.body
    }

    const response = await fetch(request.url, fetchInit)

    const text = await response.text()
    return {
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
      },
    }
  }

  // ── process handler ──────────────────────────────────────────────────────────

  private async handleProcess(
    request: ProcessAccessRequest
  ): Promise<ResourceAccessResponse> {
    if (!this.allowedCommands.has(request.command)) {
      throw permissionDenied(
        `process access denied: command not in allow-list: ${request.command}`
      )
    }

    const args = request.args ?? []

    return new Promise<ResourceAccessResponse>((resolve, reject) => {
      childProcess.execFile(
        request.command,
        args,
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              rpcError(
                RpcErrorCode.INTERNAL_ERROR,
                `execFile failed: ${error.message}`
              )
            )
            return
          }
          resolve({ data: { stdout, stderr } })
        }
      )
    })
  }
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function rpcError(code: number, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: number }).code = code
  return err
}

function permissionDenied(message: string): Error {
  return rpcError(RpcErrorCode.PERMISSION_DENIED, message)
}

function invalidParams(message: string): Error {
  return rpcError(RpcErrorCode.INVALID_PARAMS, message)
}
