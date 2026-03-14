import { ipcRenderer } from 'electron'

export const onboardingAPI = {
  check: (): Promise<{ needed: boolean }> => ipcRenderer.invoke('onboarding:check'),

  complete: (): Promise<{ success: boolean }> => ipcRenderer.invoke('onboarding:complete'),
}

export type OnboardingAPI = typeof onboardingAPI
