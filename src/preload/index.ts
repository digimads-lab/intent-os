import { contextBridge } from 'electron'
import { aiProviderAPI } from './api/ai-provider'
import { skillAPI } from './api/skill'
import { appAPI } from './api/app'
import { generationAPI } from './api/generation'
import { settingsAPI } from './api/settings'
import { modificationAPI } from './api/modification'
import { onboardingAPI } from './api/onboarding'

contextBridge.exposeInMainWorld('intentOS', {
  aiProvider: aiProviderAPI,
  skill: skillAPI,
  app: appAPI,
  generation: generationAPI,
  settings: settingsAPI,
  modification: modificationAPI,
  onboarding: onboardingAPI,
})
