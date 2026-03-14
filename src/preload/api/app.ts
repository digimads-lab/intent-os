import { ipcRenderer } from 'electron'
import type { AppRegistration, AppStatusChanged } from '@intentos/shared-types'

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (result.success) return result.data as T
  throw new Error(result.error ?? 'Unknown IPC error')
}

export const appAPI = {
  getAll: async (): Promise<AppRegistration[]> => {
    const result = await ipcRenderer.invoke('app:list')
    return unwrap<AppRegistration[]>(result)
  },

  launch: (appId: string): Promise<void> =>
    ipcRenderer.invoke('app:launch', appId),

  stop: (appId: string): Promise<void> =>
    ipcRenderer.invoke('app:stop', appId),

  uninstall: (appId: string): Promise<void> =>
    ipcRenderer.invoke('app:uninstall', appId),

  focus: (appId: string): Promise<void> =>
    ipcRenderer.invoke('app:focus-window', appId),

  // 订阅 App 状态变更（返回取消订阅函数）
  onStatusChanged: (cb: (event: AppStatusChanged) => void): (() => void) => {
    const handler = (_e: unknown, event: AppStatusChanged) => cb(event)
    ipcRenderer.on('app-lifecycle:status-changed', handler)
    return () => ipcRenderer.removeListener('app-lifecycle:status-changed', handler)
  },
}

export type AppAPI = typeof appAPI
