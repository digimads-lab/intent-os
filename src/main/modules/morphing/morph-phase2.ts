/**
 * 原地变形 Phase 2（方案 C：淡入淡出预热）
 *
 * 将生成窗口「原地变形」为 SkillApp 窗口，使用淡入淡出动画：
 *   1. 并行启动 SkillApp 进程（生成窗口仍在显示中）
 *   2. 等待 SkillApp 状态变为 'running'（最多 15s）
 *   3. 淡出生成窗口（200ms）
 *   4. 同时淡入 SkillApp 窗口（从 opacity=0 到 opacity=1，200ms）
 *   5. 关闭生成窗口
 *
 * 降级策略：
 *   - Linux 无合成器：委托给 Phase 1（直接切换，无动画）
 *   - 等待超时（15s）：直接切换，不做动画
 */

import { BrowserWindow } from 'electron'

import { lifecycleManager } from '../lifecycle-manager'
import type { AppStatusEvent } from '../lifecycle-manager'
import { morphToSkillApp as morphPhase1 } from './morph-phase1'
import { supportsOpacityAnimation } from './platform-detector'

// ── Re-export shared types ────────────────────────────────────────────────────

export type { MorphOptions, MorphResult } from './morph-phase1'
import type { MorphOptions, MorphResult } from './morph-phase1'

// ── Constants ─────────────────────────────────────────────────────────────────

const MORPH_TIMEOUT_MS = 15_000
const FADE_DURATION_MS = 200
const FADE_STEPS = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Animate BrowserWindow opacity from `from` to `to` over `durationMs`.
 */
function fadeWindow(
  win: BrowserWindow,
  from: number,
  to: number,
  durationMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const steps = FADE_STEPS
    const intervalMs = durationMs / steps
    const delta = (to - from) / steps
    let step = 0

    const id = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(id)
        resolve()
        return
      }
      step++
      const opacity = from + delta * step
      win.setOpacity(Math.min(1, Math.max(0, opacity)))
      if (step >= steps) {
        clearInterval(id)
        resolve()
      }
    }, intervalMs)
  })
}

/**
 * Find the BrowserWindow that belongs to a SkillApp by matching its URL.
 * SkillApp windows load from app://{appId}/ so we match the URL prefix.
 */
function findSkillAppWindow(appId: string, excludeWindowId: number): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.id === excludeWindowId) continue
    try {
      const url = win.webContents.getURL()
      if (url.startsWith(`app://${appId}/`) || url.includes(`appId=${appId}`)) {
        return win
      }
    } catch {
      // webContents may be destroyed
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
 * 原地变形 Phase 2（方案 C：淡入淡出预热）
 *
 * 流程：
 * 1. 检查平台是否支持 opacity 动画；否则委托给 Phase 1
 * 2. 获取生成窗口的当前位置和尺寸
 * 3. 订阅状态事件（在 launchApp 之前，避免竞态）
 * 4. 调用 lifecycleManager.launchApp(appId) 启动 SkillApp 进程
 * 5. 等待 SkillApp 状态变为 'running'（最多 15s）
 * 6. 定位 SkillApp 窗口，设置 opacity=0
 * 7. 淡出生成窗口（200ms）
 * 8. 同时淡入 SkillApp 窗口（200ms）
 * 9. 关闭生成窗口
 * 超时处理：15s 未收到 running 状态时，直接执行步骤 6-9（降级切换，不做动画）
 */
export async function morphToSkillApp(options: MorphOptions): Promise<MorphResult> {
  // Fallback to Phase 1 if opacity animations are not supported
  if (!supportsOpacityAnimation()) {
    return morphPhase1(options)
  }

  const { appId, generationWindowId } = options

  // Step 2 — capture generation window bounds
  const genWin = BrowserWindow.fromId(generationWindowId)
  if (!genWin || genWin.isDestroyed()) {
    return { success: false, appId, error: '生成窗口不存在或已关闭' }
  }

  const bounds = genWin.getBounds()

  // Step 3 — subscribe to status changes BEFORE launching to avoid race condition
  const runningEventPromise = waitForRunning(appId, MORPH_TIMEOUT_MS)

  // Step 4 — launch SkillApp in parallel (generation window is still visible)
  try {
    await lifecycleManager.launchApp(appId)
  } catch (err) {
    return {
      success: false,
      appId,
      error: `启动 SkillApp 失败: ${(err as Error).message}`,
    }
  }

  // Step 5 — wait for 'running' (or timeout)
  const runningEvent = await runningEventPromise
  const timedOut = runningEvent === null

  // Step 6 — find SkillApp window
  let skillWin: BrowserWindow | null = null

  // Find SkillApp window by its URL (app://{appId}/)
  skillWin = findSkillAppWindow(appId, generationWindowId)

  // Position SkillApp at same bounds, starting fully transparent
  if (skillWin && !skillWin.isDestroyed()) {
    skillWin.setBounds(bounds)
    skillWin.setOpacity(0)
    skillWin.show()
  }

  if (timedOut || skillWin === null || skillWin.isDestroyed()) {
    // Direct switch fallback — no animation
    if (!genWin.isDestroyed()) genWin.hide()
    if (skillWin && !skillWin.isDestroyed()) {
      skillWin.setOpacity(1)
      skillWin.focus()
    }
    if (!genWin.isDestroyed()) genWin.close()
    return { success: true, appId }
  }

  // Steps 7 & 8 — fade out gen window and fade in SkillApp simultaneously
  const capturedSkillWin = skillWin
  await Promise.all([
    fadeWindow(genWin, 1, 0, FADE_DURATION_MS),
    fadeWindow(capturedSkillWin, 0, 1, FADE_DURATION_MS),
  ])

  capturedSkillWin.focus()

  // Step 9 — close generation window
  if (!genWin.isDestroyed()) {
    genWin.close()
  }

  return { success: true, appId }
}
