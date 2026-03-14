/**
 * @intentos/skillapp-runtime — renderer process bridge
 *
 * Runs inside the SkillApp preload script.
 * Exposes `window.skillAppRuntime` to renderer-side business code via contextBridge.
 *
 * Usage (in preload.ts):
 *   import { exposeRuntimeAPI } from '@intentos/skillapp-runtime/renderer'
 *   exposeRuntimeAPI()
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ResourceAccessRequest,
  ResourceAccessResponse,
  HotUpdatePackage,
} from './types.js';
import { RuntimeError, RuntimeErrorCode } from './types.js';

// ── Renderer-facing interface ─────────────────────────────────────────────────

export interface PermissionResponse {
  granted: boolean;
  persistent: boolean;
  grantedAt?: string;
}

export interface SkillAppRuntimeAPI {
  callSkill(skillId: string, method: string, params: unknown): Promise<unknown>;
  accessResource(request: ResourceAccessRequest): Promise<ResourceAccessResponse>;
  requestPermission(
    resource: string,
    level: 'read' | 'write' | 'execute',
  ): Promise<PermissionResponse>;
  getAppInfo(): { appId: string; appName: string; version: number };
  onHotUpdate(callback: (pkg: HotUpdatePackage) => void): () => void;
  onSkillError(callback: (error: RuntimeError) => void): () => void;
}

// ── IPC channel constants (must match main.ts ipcMain.handle registrations) ───

const CH_CALL_SKILL         = 'runtime:callSkill';
const CH_ACCESS_RESOURCE    = 'runtime:accessResource';
const CH_REQUEST_PERMISSION = 'runtime:requestPermission';
const CH_HOT_UPDATE         = 'runtime:hotUpdate';
const CH_SKILL_ERROR        = 'runtime:skillError';

// ── App info (read once from environment at preload time) ─────────────────────

function readAppInfo(): { appId: string; appName: string; version: number } {
  const appId   = process.env['INTENTOS_APP_ID']   ?? '';
  const appName = process.env['INTENTOS_APP_NAME'] ?? appId;
  const versionRaw = process.env['INTENTOS_APP_VERSION'];
  const version = versionRaw !== undefined ? parseInt(versionRaw, 10) : 0;
  return { appId, appName, version };
}

// ── API implementation ────────────────────────────────────────────────────────

const api: SkillAppRuntimeAPI = {
  callSkill(skillId: string, method: string, params: unknown): Promise<unknown> {
    return ipcRenderer.invoke(CH_CALL_SKILL, { skillId, method, params });
  },

  accessResource(request: ResourceAccessRequest): Promise<ResourceAccessResponse> {
    return ipcRenderer.invoke(CH_ACCESS_RESOURCE, request);
  },

  requestPermission(
    resource: string,
    level: 'read' | 'write' | 'execute',
  ): Promise<PermissionResponse> {
    // Bridge flat (resource, level) signature to PermissionRequest shape used by main.ts
    return ipcRenderer.invoke(CH_REQUEST_PERMISSION, {
      resourceType: 'fs' as const,
      resourcePath: resource,
      action: level,
      reason: '',
    });
  },

  getAppInfo(): { appId: string; appName: string; version: number } {
    return readAppInfo();
  },

  onHotUpdate(callback: (pkg: HotUpdatePackage) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, pkg: HotUpdatePackage) => {
      callback(pkg);
    };
    ipcRenderer.on(CH_HOT_UPDATE, listener);
    return () => {
      ipcRenderer.removeListener(CH_HOT_UPDATE, listener);
    };
  },

  onSkillError(callback: (error: RuntimeError) => void): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      raw: { code: RuntimeErrorCode; message: string },
    ) => {
      callback(new RuntimeError(raw.code, raw.message));
    };
    ipcRenderer.on(CH_SKILL_ERROR, listener);
    return () => {
      ipcRenderer.removeListener(CH_SKILL_ERROR, listener);
    };
  },
};

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Expose `window.skillAppRuntime` to the SkillApp renderer via contextBridge.
 * Call this once at the top of the preload script.
 */
export function exposeRuntimeAPI(): void {
  contextBridge.exposeInMainWorld('intentOS', api);
}
