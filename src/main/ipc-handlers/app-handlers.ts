/**
 * SkillApp lifecycle IPC handlers
 *
 * Registers ipcHub.handle() for all app:* channels.
 * Channel names match exactly what preload/api/app.ts uses via ipcRenderer.invoke().
 *
 * All responses are wrapped in { success: true, data } | { success: false, error, code }.
 *
 * Note: app-lifecycle:status-changed push events are forwarded directly by
 * LifecycleManager.emitStatusChanged() via windowManager — no duplication needed here.
 */

import type { BrowserWindow } from 'electron'

import { ipcHub } from '../ipc-hub'
import { lifecycleManager } from '../modules/lifecycle-manager'
import type { AppMeta } from '../modules/lifecycle-manager'

export function registerAppHandlers(_mainWindow: BrowserWindow): void {
  // app:launch — launch a SkillApp process
  ipcHub.register('app:launch', async (_event, appId: string) => {
    try {
      await lifecycleManager.launchApp(appId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:stop — gracefully stop a running SkillApp
  ipcHub.register('app:stop', async (_event, appId: string) => {
    try {
      await lifecycleManager.stopApp(appId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:register — register app metadata (called by generator, M-05)
  ipcHub.register('app:register', async (_event, meta: AppMeta) => {
    try {
      await lifecycleManager.registerApp(meta)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:uninstall — stop process, delete DB record, remove output directory
  ipcHub.register('app:uninstall', async (_event, appId: string) => {
    try {
      await lifecycleManager.uninstallApp(appId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:focus-window — tell the SkillApp to focus / restore its window
  ipcHub.register('app:focus-window', async (_event, appId: string) => {
    try {
      await lifecycleManager.focusAppWindow(appId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:get-status — return the current lifecycle status of an app
  ipcHub.register('app:get-status', async (_event, appId: string) => {
    try {
      const data = await lifecycleManager.getAppStatus(appId)
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  // app:list — return all registered apps ordered by createdAt desc
  ipcHub.register('app:list', async () => {
    try {
      const data = await lifecycleManager.listApps()
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })
}
