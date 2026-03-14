/**
 * M-03 LifecycleManager — core implementation
 */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

import { windowManager } from '../../window-manager'
import { AppRegistry } from './app-registry'
import type { AppStatus } from './app-status'
import {
  MAX_CRASH_COUNT,
  RESTART_DELAY_MS,
  STABLE_RUNNING_DURATION_MS,
  HANDSHAKE_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  STABLE_RUNNING_CHECK_INTERVAL_MS,
} from './config'
import { ProcessWatcher } from './process-watcher'
import type {
  AppMeta,
  AppStatusEvent,
  ICrashNotification,
  ProcessEntry,
} from './types'
import { AppError } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getIPCPath(appId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\intentos-ipc-${appId}`
  }
  return `/tmp/intentos-ipc/${appId}.sock`
}

function waitForProcessExit(
  child: import('child_process').ChildProcess,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Process exit timeout'))
    }, timeoutMs)

    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })

    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// ── LifecycleManager ──────────────────────────────────────────────────────────

export class LifecycleManager {
  private readonly registry: AppRegistry
  private readonly processRegistry = new Map<string, ProcessEntry>()
  private readonly statusChangeHandlers = new Set<(event: AppStatusEvent) => void>()
  private readonly stopRequests = new Set<string>()
  private readonly processWatcher: ProcessWatcher
  private stableRunningTimer: ReturnType<typeof setInterval> | null = null

  constructor(dbPath: string) {
    this.registry = new AppRegistry(dbPath)
    this.processWatcher = new ProcessWatcher(this)
    this.registry.restoreOnStartup()
    this.startStableRunningMonitor()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a newly generated SkillApp in the database (status = 'registered').
   */
  async registerApp(meta: AppMeta): Promise<void> {
    const now = new Date().toISOString()
    const record: AppMeta = {
      ...meta,
      status:     'registered',
      crashCount: meta.crashCount ?? 0,
      createdAt:  meta.createdAt  ?? now,
      updatedAt:  now,
    }
    this.registry.insertApp(record)
  }

  /**
   * Launch the SkillApp process.
   * Transitions: registered/stopped/crashed → starting → running (on IPC handshake)
   */
  async launchApp(appId: string): Promise<void> {
    const row = this.registry.getApp(appId)
    if (!row) {
      throw new AppError('APP_NOT_FOUND', `应用 ${appId} 不存在`, 404)
    }

    if (row.status === 'running') {
      throw new AppError('APP_ALREADY_RUNNING', `应用 ${appId} 已在运行`, 409)
    }

    const previousStatus = row.status
    this.registry.updateStatus(appId, 'starting')
    this.emitStatusChanged(appId, 'starting', previousStatus)

    try {
      const ipcPath   = getIPCPath(appId)
      const appPath   = path.join(row.outputDir, row.entryPoint)
      const electronPath = process.execPath

      const child = spawn(electronPath, [appPath], {
        env: {
          // Whitelist only the env vars needed by the SkillApp process.
          // Do NOT spread process.env — that would leak API keys, DB credentials,
          // and other secrets stored in the Desktop's environment to third-party SkillApp code.
          PATH:                 process.env['PATH'] ?? '',
          HOME:                 process.env['HOME'] ?? '',
          TMPDIR:               process.env['TMPDIR'] ?? '',
          TEMP:                 process.env['TEMP'] ?? '',
          TMP:                  process.env['TMP'] ?? '',
          USERPROFILE:          process.env['USERPROFILE'] ?? '',
          APPDATA:              process.env['APPDATA'] ?? '',
          LOCALAPPDATA:         process.env['LOCALAPPDATA'] ?? '',
          SystemRoot:           process.env['SystemRoot'] ?? '',
          INTENTOS_APP_ID:      appId,
          INTENTOS_IPC_PATH:    ipcPath,
          INTENTOS_DESKTOP_PID: String(process.pid),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: false,
      })

      this.processRegistry.set(appId, {
        child,
        ipcPath,
        startedAt: Date.now(),
      })

      // Handshake timeout — 5 s to receive 'ready' from the app runtime
      const handshakeTimer = setTimeout(() => {
        if (this.processRegistry.has(appId)) {
          const entry = this.processRegistry.get(appId)!
          this.processRegistry.delete(appId)
          this.registry.updateStatus(appId, 'crashed')
          this.emitStatusChanged(appId, 'crashed', 'starting', {
            error: { code: 'HANDSHAKE_TIMEOUT', message: 'IPC handshake timed out' },
          })
          if (!entry.child.killed) entry.child.kill('SIGKILL')
        }
      }, HANDSHAKE_TIMEOUT_MS)

      // Listen for IPC 'ready' message from the SkillApp runtime
      const onMessage = (msg: unknown): void => {
        if (
          msg !== null &&
          typeof msg === 'object' &&
          (msg as Record<string, unknown>)['type'] === 'ready' &&
          (msg as Record<string, unknown>)['appId'] === appId
        ) {
          clearTimeout(handshakeTimer)
          child.off('message', onMessage)

          this.registry.updateStatus(appId, 'running')
          this.registry.updatePid(appId, child.pid ?? null)
          this.emitStatusChanged(appId, 'running', 'starting')
        }
      }
      child.on('message', onMessage)

      // Register with ProcessWatcher for crash detection
      this.processWatcher.watchProcess(child, appId)

    } catch (err) {
      this.processRegistry.delete(appId)
      this.registry.updateStatus(appId, 'crashed')
      this.emitStatusChanged(appId, 'crashed', 'starting', {
        error: { code: 'APP_START_FAILED', message: (err as Error).message },
      })
      throw new AppError(
        'APP_START_FAILED',
        `应用启动失败: ${(err as Error).message}`,
        500
      )
    }
  }

  /**
   * Gracefully stop a running SkillApp.
   * Idempotent: returns immediately if already stopped.
   */
  async stopApp(appId: string): Promise<void> {
    const row = this.registry.getApp(appId)
    if (!row) {
      throw new AppError('APP_NOT_FOUND', `应用 ${appId} 不存在`, 404)
    }

    if (row.status === 'stopped') {
      return  // idempotent
    }

    // Mark stop request so ProcessWatcher won't treat exit as a crash
    this.stopRequests.add(appId)

    try {
      const previousStatus = row.status
      this.registry.updateStatus(appId, 'stopped')
      this.registry.updatePid(appId, null)
      this.emitStatusChanged(appId, 'stopped', previousStatus)

      const entry = this.processRegistry.get(appId)
      if (!entry) return

      const { child } = entry

      // Send graceful shutdown IPC message
      try {
        child.send({ type: 'lifecycle-shutdown', appId })
      } catch {
        // IPC channel already closed — proceed to signals
      }

      // Send SIGTERM
      child.kill('SIGTERM')

      try {
        await waitForProcessExit(child, STOP_TIMEOUT_MS)
      } catch {
        // Timeout — escalate to SIGKILL
        if (!child.killed) {
          child.kill('SIGKILL')
          await waitForProcessExit(child, 1_000).catch(() => { /* best-effort */ })
        }
      } finally {
        this.processRegistry.delete(appId)
      }
    } finally {
      this.stopRequests.delete(appId)
    }
  }

  /**
   * Uninstall a SkillApp: stop process → delete DB record → rm -rf outputDir
   * → decrement Skill refs.
   */
  async uninstallApp(appId: string): Promise<void> {
    const row = this.registry.getApp(appId)
    if (!row) {
      throw new AppError('APP_NOT_FOUND', `应用 ${appId} 不存在`, 404)
    }

    const previousStatus = row.status
    this.registry.updateStatus(appId, 'uninstalling')
    this.emitStatusChanged(appId, 'uninstalling', previousStatus)

    try {
      // Stop process if running
      const entry = this.processRegistry.get(appId)
      if (entry) {
        try {
          entry.child.send({ type: 'lifecycle-shutdown', appId })
          await waitForProcessExit(entry.child, 2_000)
        } catch {
          if (!entry.child.killed) entry.child.kill('SIGKILL')
        }
        this.processRegistry.delete(appId)
      }

      // Delete DB record
      this.registry.deleteApp(appId)

      // Remove output directory
      if (fs.existsSync(row.outputDir)) {
        fs.rmSync(row.outputDir, { recursive: true, force: true })
      }

      // Emit final stopped event (app no longer in DB)
      this.emitStatusChanged(appId, 'stopped', 'uninstalling')

    } catch (err) {
      // Restore to stopped so the user can retry
      this.registry.updateStatus(appId, 'stopped')
      this.emitStatusChanged(appId, 'stopped', 'uninstalling', {
        error: { code: 'UNINSTALL_FAILED', message: (err as Error).message },
      })
      throw err
    }
  }

  /**
   * Tell the SkillApp process to focus / restore its window.
   */
  async focusAppWindow(appId: string): Promise<void> {
    const row = this.registry.getApp(appId)
    if (!row) {
      throw new AppError('APP_NOT_FOUND', `应用 ${appId} 不存在`, 404)
    }
    if (row.status !== 'running') {
      throw new AppError('APP_NOT_RUNNING', `应用 ${appId} 未运行`, 400)
    }

    const entry = this.processRegistry.get(appId)
    if (!entry) {
      throw new AppError('PROCESS_NOT_FOUND', '进程不存在（内部错误）', 500)
    }

    try {
      entry.child.send({ type: 'lifecycle-focus', appId })
    } catch (err) {
      throw new AppError(
        'IPC_SEND_FAILED',
        `IPC 发送失败: ${(err as Error).message}`,
        500
      )
    }
  }

  /** Return the current status of an app. */
  async getAppStatus(appId: string): Promise<AppStatus> {
    const row = this.registry.getApp(appId)
    if (!row) {
      throw new AppError('APP_NOT_FOUND', `应用 ${appId} 不存在`, 404)
    }
    return row.status
  }

  /** Return all registered apps ordered by createdAt desc. */
  async listApps(): Promise<AppMeta[]> {
    return this.registry.listApps().map(row => this.registry.rowToMeta(row))
  }

  /**
   * Subscribe to app status-change events.
   * Returns an unsubscribe function.
   */
  onAppStatusChanged(handler: (event: AppStatusEvent) => void): () => void {
    this.statusChangeHandlers.add(handler)
    return () => { this.statusChangeHandlers.delete(handler) }
  }

  /**
   * Called by ProcessWatcher when a process exits abnormally.
   */
  async handleCrash(appId: string, info: ICrashNotification): Promise<void> {
    const row = this.registry.getApp(appId)
    if (!row) return

    // Persist crash
    this.registry.incrementCrashCount(appId)

    // Re-read the updated row to get the new crashCount
    const updated = this.registry.getApp(appId)
    const newCrashCount = updated?.crashCount ?? (row.crashCount + 1)

    // Clean up process registry
    this.processRegistry.delete(appId)

    this.emitStatusChanged(appId, 'crashed', row.status, {
      crashCount: newCrashCount,
      error: {
        code:    'PROCESS_CRASH',
        message: `Process exited with code ${info.exitCode}, signal ${info.signal}`,
      },
    })

    // Schedule restart if within budget
    if (newCrashCount <= MAX_CRASH_COUNT) {
      await this.scheduleRestart(appId, newCrashCount)
    }
    // else: stay in 'crashed', user must intervene
  }

  /** Check whether a stop was requested by the user (not a crash). */
  isStopRequested(appId: string): boolean {
    return this.stopRequests.has(appId)
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async scheduleRestart(appId: string, crashCount: number): Promise<void> {
    const delayMs = RESTART_DELAY_MS[crashCount - 1] ?? 0

    this.registry.updateStatus(appId, 'restarting')
    this.emitStatusChanged(appId, 'restarting', 'crashed', { crashCount })

    setTimeout(() => {
      this.launchApp(appId).catch((err: Error) => {
        console.error(`[LifecycleManager] Failed to restart app ${appId}: ${err.message}`)
        this.registry.updateStatus(appId, 'crashed')
        this.emitStatusChanged(appId, 'crashed', 'restarting', {
          error: { code: 'RESTART_FAILED', message: err.message },
        })
      })
    }, delayMs)
  }

  private startStableRunningMonitor(): void {
    this.stableRunningTimer = setInterval(() => {
      const runningRows = this.registry.listApps().filter(
        r => r.status === 'running' && r.pid !== null
      )

      for (const row of runningRows) {
        if (row.crashCount === 0) continue

        const lastCrashTime = row.lastCrashAt
          ? new Date(row.lastCrashAt).getTime()
          : 0

        const elapsed = Date.now() - lastCrashTime

        if (elapsed >= STABLE_RUNNING_DURATION_MS) {
          this.registry.resetCrashCount(row.id)
        }
      }
    }, STABLE_RUNNING_CHECK_INTERVAL_MS)

    // Do not hold Node.js open just for this timer
    if (this.stableRunningTimer.unref) {
      this.stableRunningTimer.unref()
    }
  }

  private emitStatusChanged(
    appId: string,
    newStatus: AppStatus,
    previousStatus: AppStatus,
    extra?: { crashCount?: number; error?: { code: string; message: string } }
  ): void {
    const event: AppStatusEvent = {
      appId,
      status:         newStatus,
      previousStatus,
      timestamp:      Date.now(),
      ...extra,
    }

    for (const handler of this.statusChangeHandlers) {
      try {
        handler(event)
      } catch (err) {
        console.error('[LifecycleManager] Status change handler threw:', err)
      }
    }

    // Forward to Desktop renderer via Electron IPC
    const mainWindow = windowManager.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-lifecycle:status-changed', event)
    }
  }
}
