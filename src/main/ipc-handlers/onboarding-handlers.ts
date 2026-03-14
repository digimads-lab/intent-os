import { ipcMain } from 'electron'

import { isOnboardingNeeded, markOnboardingComplete } from '../modules/onboarding/onboarding'

export function registerOnboardingHandlers(): void {
  ipcMain.handle('onboarding:check', async () => {
    const needed = await isOnboardingNeeded()
    return { needed }
  })

  ipcMain.handle('onboarding:complete', async () => {
    try {
      await markOnboardingComplete()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
