import { ipcMain } from 'electron'
import type { AIProviderManager } from '../modules/ai-provider'

export function registerSettingsHandlers(providerManager: AIProviderManager): void {
  // NOTE: settings:save-api-key and settings:test-connection are registered
  // by AIProviderBridge.registerHandlers() (CR-001). Do not re-register here.

  ipcMain.handle('settings:get-connection-status', () => {
    return providerManager.getProviderStatus()
  })

  ipcMain.handle('settings:get-provider-config', () => {
    return { success: true, data: null }
  })

  ipcMain.handle('settings:set-provider-config', () => {
    return { success: true, data: null }
  })
}
