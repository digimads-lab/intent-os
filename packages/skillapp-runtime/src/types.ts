// @intentos/skillapp-runtime — shared type definitions
// Runs in both SkillApp main process and preload script.

// ── Runtime configuration ────────────────────────────────────────────────────

export interface RuntimeConfig {
  /** SkillApp unique identifier, read from INTENTOS_APP_ID */
  appId: string;
  /** Unix Socket path, read from INTENTOS_IPC_PATH / INTENTOS_SOCKET_PATH */
  ipcPath: string;
  /** PID of the Desktop (Electron main) process — informational */
  desktopPid?: number;
  /** Handshake timeout in ms (default 15000) */
  handshakeTimeout?: number;
  /** Heartbeat interval in ms (default 30000, overridden by Desktop config) */
  heartbeatInterval?: number;
}

// ── App runtime status ───────────────────────────────────────────────────────

export type AppRuntimeStatus =
  | 'starting'          // process started, Runtime.initialize() executing
  | 'ready'             // handshake complete, UI rendered
  | 'running'           // normal operation
  | 'updating'          // applying hot update
  | 'hot_update_failed' // hot update failed (Desktop triggers rollback)
  | 'stopping';         // shutting down

// ── Permission types ─────────────────────────────────────────────────────────

export interface PermissionEntry {
  resourceType: 'fs' | 'net' | 'process';
  resourcePath: string;
  action: 'read' | 'write' | 'execute' | 'connect';
  grantedAt: string;    // ISO 8601
  persistent: boolean;
}

export interface PermissionRequest {
  resourceType: 'fs' | 'net' | 'process';
  resourcePath: string;
  action: 'read' | 'write' | 'execute' | 'connect';
  reason?: string;
}

export interface PermissionResult {
  granted: boolean;
  persistent: boolean;
  grantedAt?: string;
}

// ── Resource types ───────────────────────────────────────────────────────────

export interface ResourceAccessRequest {
  type: 'fs' | 'net' | 'process';
  path?: string;
  action: 'read' | 'write' | 'execute' | 'connect';
  metadata?: Record<string, unknown>;
}

export interface ResourceError {
  code: number;
  message: string;
  resourceType?: string;
  resourcePath?: string;
}

export interface ResourceAccessResponse {
  success: boolean;
  data?: unknown;
  error?: ResourceError;
}

// ── Skill call types ─────────────────────────────────────────────────────────

export interface SkillCallRequest {
  skillId: string;
  method: string;
  params: unknown;
}

export interface SkillCallResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ── Hot update types ─────────────────────────────────────────────────────────

export interface ModuleUpdate {
  path: string;
  action: 'add' | 'modify' | 'delete';
  content?: string;           // base64 encoded
  compiledContent?: string;   // base64 encoded
}

export interface ManifestDelta {
  addedSkills?: string[];
  removedSkills?: string[];
  addedPermissions?: PermissionEntry[];
  removedPermissions?: PermissionEntry[];
}

export interface HotUpdatePackage {
  appId: string;
  fromVersion: string;
  toVersion: string;
  timestamp: number;
  modules: ModuleUpdate[];
  manifest: ManifestDelta;
  checksum: string;   // SHA-256 hex
}

export interface HotUpdateResult {
  success: boolean;
  degraded: boolean;  // true = fell back to webContents.reloadIgnoringCache()
  error?: string;
}

// ── Desktop runtime config (from handshake response) ────────────────────────

export interface DesktopRuntimeConfig {
  heartbeatInterval: number;
  skillCallTimeout: number;
  resourceAccessTimeout: number;
}

// ── JSON-RPC 2.0 message types ───────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: string | number;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  // no id field
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  result: unknown;
  id: string | number;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── Error codes ──────────────────────────────────────────────────────────────

export enum RuntimeErrorCode {
  // Socket connection errors (1000–1099)
  SOCKET_CONNECT_FAILED      = 1001,
  SOCKET_DISCONNECTED        = 1002,
  RECONNECT_EXHAUSTED        = 1003,

  // Handshake errors (1100–1199)
  HANDSHAKE_TIMEOUT          = 1100,
  HANDSHAKE_REJECTED         = 1101,
  HANDSHAKE_INVALID_RESPONSE = 1102,

  // Skill call errors (2000–2099)
  SKILL_CALL_TIMEOUT         = 2001,
  SKILL_NOT_FOUND            = 2002,

  // Skill execution errors (2100–2199)
  SKILL_EXECUTION_ERROR      = 2100,

  // Permission errors (3000–3099)
  PERMISSION_DENIED          = 3001,
  PERMISSION_USER_DENIED     = 3002,

  // Resource access errors (4000–4099)
  RESOURCE_ACCESS_TIMEOUT    = 4001,
  RESOURCE_NOT_FOUND         = 4002,
  RESOURCE_ACCESS_DENIED     = 4003,

  // Hot update errors (5000–5099)
  HOT_UPDATE_CHECKSUM_MISMATCH = 5001,
  HOT_UPDATE_APPLY_FAILED      = 5002,
}

export class RuntimeError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}
