/**
 * @intentos/skillapp-runtime — main process entry
 *
 * Runs inside the SkillApp Electron main process.
 * Responsibilities:
 *   - Connect to IntentOS Desktop via Unix Socket
 *   - Perform JSON-RPC 2.0 handshake
 *   - Cache granted permissions in memory
 *   - Bridge Electron IPC → Unix Socket for skill calls / resource access
 *   - Send periodic heartbeats
 *   - Receive and dispatch Desktop-pushed notifications (hotUpdate, lifecycle.*)
 */

import * as net from 'net';
import * as crypto from 'crypto';
import { ipcMain } from 'electron';
import type {
  RuntimeConfig,
  AppRuntimeStatus,
  PermissionEntry,
  PermissionRequest,
  PermissionResult,
  ResourceAccessRequest,
  ResourceAccessResponse,
  HotUpdatePackage,
  HotUpdateResult,
  DesktopRuntimeConfig,
  JsonRpcMessage,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from './types.js';
import { RuntimeError, RuntimeErrorCode } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const RUNTIME_VERSION = '1.0.0';
const DEFAULT_HANDSHAKE_TIMEOUT = 15_000;
const DEFAULT_HEARTBEAT_INTERVAL = 30_000;
const DEFAULT_SKILL_CALL_TIMEOUT = 10_000;
const DEFAULT_RESOURCE_ACCESS_TIMEOUT = 10_000;
const SOCKET_CONNECT_RETRIES = 5;
const SOCKET_CONNECT_RETRY_DELAY = 500;
const HEARTBEAT_MISSED_THRESHOLD = 3;
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024; // 1 MB
const RECONNECT_DELAYS = [1_000, 2_000, 4_000];

// ── Pending-call registry ────────────────────────────────────────────────────

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

// ── Permission cache key ─────────────────────────────────────────────────────

type PermissionCacheKey = string; // "${resourceType}:${resourcePath}:${action}"

function buildResourceKey(
  resourceType: string,
  resourcePath: string,
  action: string,
): PermissionCacheKey {
  return `${resourceType}:${resourcePath}:${action}`;
}

// ── Runtime class ────────────────────────────────────────────────────────────

class SkillAppRuntime {
  private config: RuntimeConfig;
  private socket: net.Socket | null = null;
  private buffer = '';
  private pendingCalls = new Map<string, PendingCall>();
  private permissionCache = new Map<PermissionCacheKey, PermissionEntry>();
  private desktopConfig: DesktopRuntimeConfig = {
    heartbeatInterval: DEFAULT_HEARTBEAT_INTERVAL,
    skillCallTimeout: DEFAULT_SKILL_CALL_TIMEOUT,
    resourceAccessTimeout: DEFAULT_RESOURCE_ACCESS_TIMEOUT,
  };
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0;
  private hotUpdateHandler: ((pkg: HotUpdatePackage) => void) | null = null;
  private status: AppRuntimeStatus = 'starting';
  private ipcHandlersRegistered = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize the runtime: connect to Desktop, complete handshake, cache permissions.
   * Must be called inside app.whenReady(), before creating BrowserWindow.
   */
  async initialize(): Promise<void> {
    this.status = 'starting';
    this.stopHeartbeat(); // ensure no leftover timer on re-initialization
    await this.connectWithRetry();
    await this.performHandshake();
    this.startHeartbeat();
    this.registerIpcHandlers();

    // Notify parent process (M-03 spawner) that runtime is ready
    if (process.send) {
      process.send({ type: 'ready', appId: this.config.appId });
    }
  }

  /**
   * Call a Skill method through Desktop via JSON-RPC skill.call.
   */
  async callSkill(skillId: string, method: string, params: unknown): Promise<unknown> {
    return this.sendRequest('skill.call', {
      skillId,
      method,
      params,
      callerAppId: this.config.appId,
    }, this.desktopConfig.skillCallTimeout);
  }

  /**
   * Access a host OS resource.
   * Checks permission cache first; requests user authorization on miss.
   */
  async accessResource(request: ResourceAccessRequest): Promise<ResourceAccessResponse> {
    const resourcePath = request.path ?? '';
    const cacheKey = buildResourceKey(request.type, resourcePath, request.action);

    if (!this.permissionCache.has(cacheKey)) {
      // Cache miss — request permission from Desktop (triggers user dialog)
      const permResult = await this.requestPermission({
        resourceType: request.type,
        resourcePath,
        action: request.action,
      });

      if (!permResult.granted) {
        return {
          success: false,
          error: {
            code: RuntimeErrorCode.PERMISSION_USER_DENIED,
            message: 'User denied permission',
            resourceType: request.type,
            resourcePath,
          },
        };
      }

      // Cache persistent grants
      if (permResult.persistent && permResult.grantedAt) {
        this.permissionCache.set(cacheKey, {
          resourceType: request.type,
          resourcePath,
          action: request.action,
          grantedAt: permResult.grantedAt,
          persistent: true,
        });
      }
    }

    // Permission confirmed — forward resource.access to Desktop
    const result = await this.sendRequest('resource.access', {
      type: request.type,
      path: request.path,
      action: request.action,
      metadata: request.metadata ?? {},
      callerAppId: this.config.appId,
    }, this.desktopConfig.resourceAccessTimeout) as ResourceAccessResponse;

    return result;
  }

  /**
   * Request user authorization for a resource (triggers Desktop permission dialog).
   */
  async requestPermission(request: PermissionRequest): Promise<PermissionResult> {
    const result = await this.sendRequest('permission.request', {
      resourceType: request.resourceType,
      resourcePath: request.resourcePath,
      action: request.action,
      reason: request.reason ?? '',
      callerAppId: this.config.appId,
    }, 60_000) as PermissionResult; // 60s — waits for user interaction

    return result;
  }

  /**
   * Apply a hot update package.
   * Stub for Iter 5 — currently always returns not-implemented degraded result.
   */
  async applyHotUpdate(_pkg: HotUpdatePackage): Promise<HotUpdateResult> {
    // TODO (Iter 5): implement dynamic import() module replacement
    return { success: false, degraded: false, error: 'Hot update not yet implemented (Iter 5)' };
  }

  /**
   * Report runtime status to Desktop.
   */
  async reportStatus(status: AppRuntimeStatus): Promise<void> {
    this.status = status;
    this.sendNotification('status.report', {
      appId: this.config.appId,
      status,
      timestamp: Date.now(),
    });
  }

  /**
   * Register a handler called when Desktop pushes a hotUpdate notification.
   */
  onHotUpdate(handler: (pkg: HotUpdatePackage) => void): void {
    this.hotUpdateHandler = handler;
  }

  /**
   * Tear down the runtime: stop heartbeat, close socket, remove IPC handlers.
   * Call in app.on('window-all-closed').
   */
  destroy(): void {
    this.stopHeartbeat();
    this.socket?.destroy();
    this.socket = null;

    if (this.ipcHandlersRegistered) {
      ipcMain.removeHandler('runtime:callSkill');
      ipcMain.removeHandler('runtime:accessResource');
      ipcMain.removeHandler('runtime:requestPermission');
      this.ipcHandlersRegistered = false;
    }

    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new RuntimeError(RuntimeErrorCode.SOCKET_DISCONNECTED, 'Runtime destroyed'));
      this.pendingCalls.delete(id);
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private async connectWithRetry(): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < SOCKET_CONNECT_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(SOCKET_CONNECT_RETRY_DELAY);
      }
      try {
        await this.connect();
        return;
      } catch (err) {
        lastError = err as Error;
      }
    }

    process.exit(1);
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.config.ipcPath);

      socket.once('connect', () => {
        this.socket = socket;
        this.buffer = '';
        this.setupSocketHandlers(socket);
        resolve();
      });

      socket.once('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });
  }

  private setupSocketHandlers(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => this.handleData(chunk));

    socket.on('error', (err) => {
      console.error('[skillapp-runtime] Socket error:', err.message);
    });

    socket.on('close', () => {
      console.warn('[skillapp-runtime] Socket closed');
      this.socket = null;
    });
  }

  // ── Handshake ──────────────────────────────────────────────────────────────

  private async performHandshake(): Promise<void> {
    const timeoutMs = this.config.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT;

    const handshakePromise = this.sendRequest('handshake', {
      appId: this.config.appId,
      version: '1.0.0',
      runtimeVersion: RUNTIME_VERSION,
      pid: process.pid,
      electronVersion: process.versions.electron ?? 'unknown',
    }, timeoutMs);

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new RuntimeError(RuntimeErrorCode.HANDSHAKE_TIMEOUT, 'Handshake timed out'));
      }, timeoutMs);
    });

    let result: unknown;
    try {
      result = await Promise.race([handshakePromise, timeoutPromise]);
    } catch (err) {
      this.socket?.destroy();
      process.exit(1);
      throw err;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    // Parse handshake result
    const handshakeResult = result as {
      permissions?: PermissionEntry[];
      config?: {
        heartbeatInterval?: number;
        skillCallTimeout?: number;
        resourceAccessTimeout?: number;
      };
    };

    if (handshakeResult.permissions) {
      this.buildPermissionCache(handshakeResult.permissions);
    }

    if (handshakeResult.config) {
      this.desktopConfig = {
        heartbeatInterval: handshakeResult.config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
        skillCallTimeout: handshakeResult.config.skillCallTimeout ?? DEFAULT_SKILL_CALL_TIMEOUT,
        resourceAccessTimeout: handshakeResult.config.resourceAccessTimeout ?? DEFAULT_RESOURCE_ACCESS_TIMEOUT,
      };
    }
  }

  // ── Permission cache ───────────────────────────────────────────────────────

  private buildPermissionCache(permissions: PermissionEntry[]): void {
    this.permissionCache.clear();
    for (const entry of permissions) {
      const key = buildResourceKey(entry.resourceType, entry.resourcePath, entry.action);
      this.permissionCache.set(key, entry);
    }
  }

  private clearPermissionCache(): void {
    this.permissionCache.clear();
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? this.desktopConfig.heartbeatInterval;
    this.missedHeartbeats = 0;

    this.heartbeatTimer = setInterval(async () => {
      this.sendNotification('heartbeat', {
        appId: this.config.appId,
        timestamp: Date.now(),
        status: this.status,
        metrics: {
          memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          cpuPercent: 0, // lightweight stub
          activeSkillCalls: this.pendingCalls.size,
          permissionCacheSize: this.permissionCache.size,
        },
      });

      this.missedHeartbeats += 1;

      if (this.missedHeartbeats >= HEARTBEAT_MISSED_THRESHOLD) {
        this.stopHeartbeat();
        await this.attemptReconnect();
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resetHeartbeatMissedCount(): void {
    this.missedHeartbeats = 0;
  }

  private async attemptReconnect(): Promise<void> {
    for (const delay of RECONNECT_DELAYS) {
      await sleep(delay);
      try {
        await this.initialize();
        return;
      } catch {
        // continue to next attempt
      }
    }
    // All reconnect attempts exhausted — report degraded state
    await this.reportStatus('stopping');
  }

  // ── Message framing ────────────────────────────────────────────────────────

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');

    // Guard against oversized messages
    if (this.buffer.length > MAX_MESSAGE_SIZE) {
      console.error('[skillapp-runtime] Buffer overflow — closing socket');
      this.socket?.destroy();
      return;
    }

    // Reset heartbeat missed counter on any incoming data
    this.resetHeartbeatMissedCount();

    const messages = this.buffer.split('\n');
    // Last element may be an incomplete message — keep in buffer
    this.buffer = messages.pop() ?? '';

    for (const raw of messages) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;

      let parsed: JsonRpcMessage;
      try {
        parsed = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        console.error('[skillapp-runtime] JSON parse error for message:', trimmed.slice(0, 200));
        continue;
      }

      this.dispatchMessage(parsed);
    }
  }

  private dispatchMessage(msg: JsonRpcMessage): void {
    // Response to a pending request
    if ('id' in msg && msg.id !== null && msg.id !== undefined && !('method' in msg)) {
      const response = msg as JsonRpcSuccessResponse | JsonRpcErrorResponse;
      const id = String(response.id);
      const pending = this.pendingCalls.get(id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingCalls.delete(id);

      if ('error' in response) {
        const err = response as JsonRpcErrorResponse;
        pending.reject(new RuntimeError(
          err.error.code as RuntimeErrorCode,
          err.error.message,
        ));
      } else {
        const ok = response as JsonRpcSuccessResponse;
        pending.resolve(ok.result);
      }
      return;
    }

    // Notification from Desktop (no id, has method)
    if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg.method, (msg as { params: Record<string, unknown> }).params);
    }
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'hotUpdate': {
        const pkg = params as unknown as HotUpdatePackage;
        if (this.hotUpdateHandler) {
          this.hotUpdateHandler(pkg);
        }
        break;
      }

      case 'lifecycle.focus':
      case 'lifecycle-focus': {
        // Desktop instructs SkillApp window to focus
        // BrowserWindow.getAllWindows()[0]?.focus() would go here;
        // left for integrating Electron app code to handle
        console.info('[skillapp-runtime] lifecycle.focus received');
        break;
      }

      case 'lifecycle.stop':
      case 'lifecycle-shutdown': {
        // Desktop requests graceful shutdown
        console.info('[skillapp-runtime] lifecycle.stop received — initiating shutdown');
        this.reportStatus('stopping').finally(() => {
          this.destroy();
          // Allow the Electron app to respond to window-all-closed
          process.nextTick(() => process.exit(0));
        });
        break;
      }

      default:
        console.warn('[skillapp-runtime] Unknown notification method:', method);
    }
  }

  // ── JSON-RPC helpers ───────────────────────────────────────────────────────

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new RuntimeError(RuntimeErrorCode.SOCKET_DISCONNECTED, 'Socket not connected'));
        return;
      }

      const id = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        const errorCode = method === 'skill.call'
          ? RuntimeErrorCode.SKILL_CALL_TIMEOUT
          : method === 'resource.access'
            ? RuntimeErrorCode.RESOURCE_ACCESS_TIMEOUT
            : RuntimeErrorCode.HANDSHAKE_TIMEOUT;
        reject(new RuntimeError(errorCode, `Request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCalls.set(id, { resolve, reject, timer });

      const message = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
      this.socket.write(message, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingCalls.delete(id);
          reject(new RuntimeError(RuntimeErrorCode.SOCKET_DISCONNECTED, err.message));
        }
      });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed) return;
    const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.socket.write(message, (err) => {
      if (err) {
        console.error(`[skillapp-runtime] Failed to send notification "${method}":`, err.message);
      }
    });
  }

  // ── Electron IPC handler registration ─────────────────────────────────────

  private registerIpcHandlers(): void {
    if (this.ipcHandlersRegistered) return;

    ipcMain.handle('runtime:callSkill', (_event, args: { skillId: string; method: string; params: unknown }) => {
      return this.callSkill(args.skillId, args.method, args.params);
    });

    ipcMain.handle('runtime:accessResource', (_event, request: ResourceAccessRequest) => {
      return this.accessResource(request);
    });

    ipcMain.handle('runtime:requestPermission', (_event, request: PermissionRequest) => {
      return this.requestPermission(request);
    });

    this.ipcHandlersRegistered = true;
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Module-level singleton and exported API ──────────────────────────────────

let _runtime: SkillAppRuntime | null = null;

function getRuntime(): SkillAppRuntime {
  if (!_runtime) {
    throw new Error('[skillapp-runtime] Runtime not initialized. Call initRuntime() first.');
  }
  return _runtime;
}

/**
 * Initialize the SkillApp runtime.
 * Reads INTENTOS_APP_ID and INTENTOS_IPC_PATH from environment variables.
 */
export async function initRuntime(config?: Partial<RuntimeConfig>): Promise<void> {
  const appId = config?.appId ?? process.env['INTENTOS_APP_ID'];
  const ipcPath = config?.ipcPath
    ?? process.env['INTENTOS_IPC_PATH']
    ?? process.env['INTENTOS_SOCKET_PATH'];

  if (!appId) {
    console.error('[skillapp-runtime] INTENTOS_APP_ID environment variable not set');
    process.exit(1);
  }
  if (!ipcPath) {
    console.error('[skillapp-runtime] INTENTOS_IPC_PATH environment variable not set');
    process.exit(1);
  }

  const resolvedConfig: RuntimeConfig = {
    appId,
    ipcPath,
    desktopPid: config?.desktopPid,
    handshakeTimeout: config?.handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT,
    heartbeatInterval: config?.heartbeatInterval,
  };

  _runtime = new SkillAppRuntime(resolvedConfig);
  await _runtime.initialize();
}

/**
 * Call a Skill through Desktop via JSON-RPC skill.call.
 */
export function callSkill(skillId: string, method: string, params: unknown): Promise<unknown> {
  return getRuntime().callSkill(skillId, method, params);
}

/**
 * Access a host OS resource (checks permission cache, requests if needed).
 */
export function accessResource(request: ResourceAccessRequest): Promise<ResourceAccessResponse> {
  return getRuntime().accessResource(request);
}

/**
 * Request user authorization for a resource.
 */
export function requestPermission(request: PermissionRequest): Promise<PermissionResult> {
  return getRuntime().requestPermission(request);
}

/**
 * Apply a hot update package (stub — Iter 5 implementation).
 */
export function applyHotUpdate(pkg: HotUpdatePackage): Promise<HotUpdateResult> {
  return getRuntime().applyHotUpdate(pkg);
}

/**
 * Report runtime status to Desktop.
 */
export function reportStatus(status: AppRuntimeStatus): Promise<void> {
  return getRuntime().reportStatus(status);
}

/**
 * Register a hot update handler.
 */
export function onHotUpdate(handler: (pkg: HotUpdatePackage) => void): void {
  getRuntime().onHotUpdate(handler);
}

/**
 * Destroy the runtime (call before process exit).
 */
export function destroy(): void {
  getRuntime().destroy();
  _runtime = null;
}

// Default export — module-level object matching SkillApp main.js integration pattern
export default {
  initialize: initRuntime,
  callSkill,
  accessResource,
  requestPermission,
  applyHotUpdate,
  reportStatus,
  onHotUpdate,
  destroy,
};
