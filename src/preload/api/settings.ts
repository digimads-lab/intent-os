import { ipcRenderer } from 'electron'
import type { ProviderConfig, ProviderStatus, CustomProviderConfig } from '@intentos/shared-types'

export const settingsAPI = {
  // 保存 API Key (providerId 缺省为 'claude-api'，向后兼容)
  saveApiKey: (apiKey: string, providerId?: string): Promise<void> =>
    ipcRenderer.invoke('settings:save-api-key', { apiKey, providerId }),

  // 获取 API Key (masked)
  getApiKey: (providerId?: string): Promise<{ key: string | null; configured: boolean }> =>
    ipcRenderer.invoke('settings:get-api-key', { providerId }),

  // 测试连接（返回延迟 ms，-1 表示失败）
  testConnection: (): Promise<{ success: boolean; latencyMs?: number; providerName?: string; error?: string }> =>
    ipcRenderer.invoke('settings:test-connection'),

  // 获取当前 Provider 配置
  getProviderConfig: (): Promise<ProviderConfig | null> =>
    ipcRenderer.invoke('settings:get-provider-config'),

  // 更新 Provider 配置
  setProviderConfig: (config: ProviderConfig): Promise<void> =>
    ipcRenderer.invoke('settings:set-provider-config', { config }),

  // 获取当前连接状态
  getConnectionStatus: (): Promise<ProviderStatus> =>
    ipcRenderer.invoke('settings:get-connection-status'),

  // CR-001: 切换激活 Provider
  setProvider: (config: { providerId: string; config?: ProviderConfig }): Promise<{ success: boolean; error?: { code: string; message: string } }> =>
    ipcRenderer.invoke('ai-provider:set-provider', config),

  // CR-001: 获取自定义 Provider 配置（不含 API Key）
  getCustomProviderConfig: (): Promise<{ config: CustomProviderConfig | null; hasApiKey: boolean }> =>
    ipcRenderer.invoke('settings:get-custom-provider-config'),

  // CR-001: 保存自定义 Provider 配置
  setCustomProviderConfig: (payload: {
    baseUrl: string;
    planModel: string;
    codegenModel: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<{ success: boolean; error?: { code: string; message: string } }> =>
    ipcRenderer.invoke('settings:set-custom-provider-config', payload),
}

export type SettingsAPI = typeof settingsAPI
