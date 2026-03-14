import { ipcRenderer } from 'electron'

export const modificationAPI = {
  // Start incremental modification planning — returns sessionId immediately
  start: (appId: string, requirement: string): Promise<{ sessionId: string; status: string }> =>
    ipcRenderer.invoke('modification:start-plan', { appId, requirement }),

  // Confirm plan and trigger hot update (fire-and-forget; progress via onProgress)
  confirm: (sessionId: string): Promise<{ status: string }> =>
    ipcRenderer.invoke('modification:confirm', { sessionId }),

  // Cancel an active modification session
  cancel: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('modification:cancel', { sessionId }),

  // Subscribe to incremental plan chunks (streams ModifySession once complete)
  onPlanChunk: (sessionId: string, cb: (chunk: unknown) => void): (() => void) => {
    const channel = `modification:plan-chunk:${sessionId}`
    const handler = (_e: unknown, chunk: unknown) => cb(chunk)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // Subscribe to hot-update progress events
  onProgress: (sessionId: string, cb: (progress: unknown) => void): (() => void) => {
    const channel = `modification:progress:${sessionId}`
    const handler = (_e: unknown, progress: unknown) => cb(progress)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // Subscribe to modification errors
  onError: (sessionId: string, cb: (error: { code: string; message: string }) => void): (() => void) => {
    const channel = `modification:error:${sessionId}`
    const handler = (_e: unknown, error: { code: string; message: string }) => cb(error)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

export type ModificationAPI = typeof modificationAPI

