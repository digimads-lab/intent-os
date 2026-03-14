import { ipcRenderer } from 'electron'
import type { SkillRegistration } from '@intentos/shared-types'

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (result.success) return result.data as T
  throw new Error(result.error ?? 'Unknown IPC error')
}

export const skillAPI = {
  // 获取所有已安装 Skill 列表
  getInstalled: async (): Promise<SkillRegistration[]> => {
    const result = await ipcRenderer.invoke('skill:list')
    return unwrap<SkillRegistration[]>(result)
  },

  // 注册 Skill（通过目录路径）
  register: async (directoryPath: string): Promise<SkillRegistration> => {
    const result = await ipcRenderer.invoke('skill:register', { directoryPath })
    return unwrap<SkillRegistration>(result)
  },

  // 卸载 Skill
  unregister: async (skillId: string): Promise<void> => {
    const result = await ipcRenderer.invoke('skill:unregister', { skillId })
    unwrap<void>(result)
  },

  // 获取 Skill 详情
  getById: async (skillId: string): Promise<SkillRegistration | null> => {
    const result = await ipcRenderer.invoke('skill:get', { skillId })
    return unwrap<SkillRegistration | null>(result)
  },

  // 检查依赖（卸载前调用）
  checkDependencies: async (skillId: string): Promise<{ hasApps: boolean; appNames: string[] }> => {
    const result = await ipcRenderer.invoke('skill:check-dependencies', { skillId })
    return unwrap<{ hasApps: boolean; appNames: string[] }>(result)
  },

  // 订阅 Skill 变更事件（返回取消订阅函数）
  onChanged: (cb: (event: unknown) => void): (() => void) => {
    const handler = (_e: unknown, event: unknown) => cb(event)
    ipcRenderer.on('skill-manager:changed', handler)
    return () => ipcRenderer.removeListener('skill-manager:changed', handler)
  },
}

export type SkillAPI = typeof skillAPI
