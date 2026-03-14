/**
 * M-03 LifecycleManager — AppStatus enum and meanings
 */

// ── AppStatus ─────────────────────────────────────────────────────────────────

export type AppStatus =
  | 'registered'    // App registered in DB, never launched
  | 'starting'      // Process spawning, waiting for IPC handshake
  | 'running'       // Process running normally
  | 'crashed'       // Process exited abnormally
  | 'restarting'    // Crashed, scheduled for restart (1–3rd attempt)
  | 'uninstalling'  // Uninstall flow in progress
  | 'stopped'       // Stopped by user or uninstall complete

// ── AppStatusMeanings ─────────────────────────────────────────────────────────

export const AppStatusMeanings = {
  registered:   '应用已注册，未曾启动',
  starting:     '正在启动中，等待 IPC 握手完成',
  running:      '进程正常运行中',
  crashed:      '进程异常退出，等待手动干预或自动重启',
  restarting:   '检测到崩溃，正在重启（第 N 次）',
  uninstalling: '应用卸载流程进行中',
  stopped:      '应用已停止或卸载完成',
} as const satisfies Record<AppStatus, string>
