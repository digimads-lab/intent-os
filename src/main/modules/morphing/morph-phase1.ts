/**
 * 原地变形 Phase 1（方案 B：位置迁移）
 *
 * 将生成窗口「原地变形」为 SkillApp 窗口：
 *   1. 记录生成窗口的位置和尺寸
 *   2. 启动 SkillApp 进程
 *   3. 等待 SkillApp 状态变为 'running'（最多 15s）
 *   4. 隐藏生成窗口 → 将 SkillApp BrowserWindow 移到相同位置 → show
 *   5. 关闭生成窗口
 */

import { BrowserWindow, webContents } from 'electron'

import { lifecycleManager } from '../lifecycle-manager'
import type { AppStatusEvent } from '../lifecycle-manager'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MorphOptions {
  /** 生成会话 ID */
  sessionId: string
  /** 生成窗口的 BrowserWindow.id */
  generationWindowId: number
  /** 已注册的 SkillApp appId */
  appId: string
}

export interface MorphResult {
  success: boolean
  appId: string
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MORPH_TIMEOUT_MS = 15_000

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the BrowserWindow that belongs to a SkillApp process by matching PID.
 * Falls back to null if no match is found within the currently open windows.
 */
function findSkillAppWindow(pid: number): BrowserWindow | null {
  for (const wc of webContents.getAllWebContents()) {
    const win = BrowserWindow.fromWebContents(wc)
    if (win && !win.isDestroyed()) {
      const osPid = wc.getOSProcessId()
      if (osPid === pid) {
        return win
      }
    }
  }
  return null
}

/**
 * Wait until the SkillApp reports 'running', or resolve after timeoutMs.
 * Returns the AppStatusEvent if running was received, or null on timeout.
 */
function waitForRunning(
  appId: string,
  timeoutMs: number
): Promise<AppStatusEvent | null> {
  return new Promise<AppStatusEvent | null>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = lifecycleManager.onAppStatusChanged((event) => {
      if (event.appId !== appId || event.status !== 'running') return
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })

    timer = setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, timeoutMs)
  })
}

// ── morphToSkillApp ───────────────────────────────────────────────────────────

/**
 * 原地变形 Phase 1（方案 B：位置迁移）
 *
 * 流程：
 * 1. 获取生成窗口的当前位置和尺寸（getBounds）
 * 2. 调用 lifecycleManager.launchApp(appId) 启动 SkillApp 进程
 * 3. 监听状态事件，等待 SkillApp 状态变为 'running'（最多 15s）
 * 4. 收到 running 后：隐藏生成窗口 → 将 SkillApp BrowserWindow 移到相同位置 → show
 * 5. 关闭生成窗口
 * 超时处理：15s 未收到 running 状态时，直接执行步骤 4-5（降级切换，不卡死）
 */
export async function morphToSkillApp(options: MorphOptions): Promise<MorphResult> {
  const { appId, generationWindowId } = options

  // Step 1 — capture generation window bounds
  const genWin = BrowserWindow.fromId(generationWindowId)
  if (!genWin || genWin.isDestroyed()) {
    return { success: false, appId, error: '生成窗口不存在或已关闭' }
  }

  const bounds = genWin.getBounds()

  // Step 2 — subscribe to status changes BEFORE launching to avoid race
  const runningEventPromise = waitForRunning(appId, MORPH_TIMEOUT_MS)

  try {
    await lifecycleManager.launchApp(appId)
  } catch (err) {
    return {
      success: false,
      appId,
      error: `启动 SkillApp 失败: ${(err as Error).message}`,
    }
  }

  // Step 3 — wait for 'running' (or timeout)
  const runningEvent = await runningEventPromise

  // Step 4 — find SkillApp window: try PID match first, fall back to newest non-gen window
  let skillWin: BrowserWindow | null = null

  if (runningEvent !== null) {
    // We know the process is running; attempt PID-based lookup
    const appRow = await lifecycleManager.listApps().then(
      (apps) => apps.find((a) => a.id === appId) ?? null
    )
    if (appRow?.pid !== undefined && appRow.pid !== null) {
      skillWin = findSkillAppWindow(appRow.pid)
    }
  }

  // Fallback: if PID lookup failed or we timed out, pick the newest BrowserWindow
  // that isn't the generation window (the SkillApp may still have opened)
  if (skillWin === null) {
    const allWins = BrowserWindow.getAllWindows()
    const candidates = allWins.filter(
      (w) => !w.isDestroyed() && w.id !== generationWindowId
    )
    if (candidates.length > 0) {
      // Sort descending by id — highest id was created most recently
      candidates.sort((a, b) => b.id - a.id)
      skillWin = candidates[0] ?? null
    }
  }

  // Hide generation window, reposition SkillApp window, show it
  if (!genWin.isDestroyed()) {
    genWin.hide()
  }

  if (skillWin && !skillWin.isDestroyed()) {
    skillWin.setBounds(bounds)
    skillWin.show()
    skillWin.focus()
  }

  // Step 5 — close generation window
  if (!genWin.isDestroyed()) {
    genWin.close()
  }

  return { success: true, appId }
}
