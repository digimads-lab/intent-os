import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { electronApp, optimizer } from '@electron-toolkit/utils'

import { intentOSApp } from './app'
import { windowManager } from './window-manager'
import { AIProviderBridge, AIProviderManager, ClaudeAPIProvider, CustomOpenAIProvider } from './modules/ai-provider'
import { SkillManager, createDatabase } from './modules/skill-manager'
import { registerSkillHandlers } from './ipc-handlers/skill-handlers'
import { registerSettingsHandlers } from './ipc-handlers/settings-handlers'
import { registerGenerationHandlers } from './ipc-handlers/generation-handlers'
import { registerModificationHandlers } from './ipc-handlers/modification-handlers'
import { registerOnboardingHandlers } from './ipc-handlers/onboarding-handlers'
import { registerAppHandlers } from './ipc-handlers/app-handlers'
import { initSecurity } from './security'
import type { CustomProviderConfig } from './modules/ai-provider/interfaces'

async function loadSavedCustomConfig(): Promise<CustomProviderConfig | null> {
  try {
    const configFile = path.join(app.getPath('userData'), 'custom-provider-config.json')
    const raw = await fs.readFile(configFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.providerId === 'custom') return parsed as CustomProviderConfig
    return null
  } catch {
    return null
  }
}

app.whenReady().then(async () => {
  // Initialize security hardening after app is ready (session requires app ready)
  initSecurity()

  electronApp.setAppUserModelId('com.intentos.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await intentOSApp.initialize()

  // M-02 Skill Manager
  const db = createDatabase()
  const skillManager = new SkillManager(db)
  registerSkillHandlers(skillManager)

  // Onboarding
  registerOnboardingHandlers()

  // M-03 SkillApp lifecycle handlers
  registerAppHandlers(windowManager.getMainWindow()!)

  // M-04 AI Provider
  const providerManager = new AIProviderManager()
  const customConfig = await loadSavedCustomConfig()
  if (customConfig) {
    const customProvider = new CustomOpenAIProvider()
    providerManager.setProvider(customProvider, customConfig).catch(() => {
      // 连接失败，等待用户重新配置
    })
  } else {
    const claudeProvider = new ClaudeAPIProvider()
    providerManager.setProvider(claudeProvider, { providerId: 'claude-api' }).catch(() => {
      // API key 未配置，等待用户配置
    })
  }
  const bridge = new AIProviderBridge(providerManager)
  bridge.registerHandlers()
  registerSettingsHandlers(providerManager)

  // M-05 Generation + Modification handlers (require mainWindow for IPC routing)
  const mainWindow = windowManager.getMainWindow()
  if (mainWindow) {
    registerGenerationHandlers(mainWindow, providerManager, skillManager)
    registerModificationHandlers(mainWindow, providerManager)
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})
