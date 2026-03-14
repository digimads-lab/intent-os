import { create } from 'zustand'
import type { AppRegistration, AppStatusChanged } from '@intentos/shared-types'

interface AppStore {
  apps: AppRegistration[]
  isLoading: boolean
  error: string | null

  fetchApps(): Promise<void>
  launchApp(appId: string): Promise<void>
  stopApp(appId: string): Promise<void>
  uninstallApp(appId: string): Promise<void>
  focusApp(appId: string): Promise<void>
  updateAppStatus(event: AppStatusChanged): void
}

export const useAppStore = create<AppStore>((set) => ({
  apps: [],
  isLoading: false,
  error: null,

  fetchApps: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.intentOS.app.getAll()
      set({ apps: result, isLoading: false })
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  launchApp: async (appId: string) => {
    set({ error: null })
    try {
      await window.intentOS.app.launch(appId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  stopApp: async (appId: string) => {
    set({ error: null })
    try {
      await window.intentOS.app.stop(appId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  uninstallApp: async (appId: string) => {
    set({ error: null })
    try {
      await window.intentOS.app.uninstall(appId)
      // Remove from local list immediately
      set((state) => ({ apps: state.apps.filter((a) => a.id !== appId) }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  focusApp: async (appId: string) => {
    set({ error: null })
    try {
      await window.intentOS.app.focus(appId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  updateAppStatus: (event: AppStatusChanged) => {
    set((state) => ({
      apps: state.apps.map((app) => {
        if (app.id !== event.appId) return app
        return {
          ...app,
          status: event.status,
          pid: event.pid,
        }
      }),
    }))
  },
}))
