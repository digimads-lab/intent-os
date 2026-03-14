/**
 * Skill Manager IPC handlers
 *
 * Registers ipcMain.handle() for all skill:* channels.
 * Channel names match exactly what preload/api/skill.ts uses via ipcRenderer.invoke().
 *
 * All responses are wrapped in IPCResult<T>:
 *   success → { success: true, data: T }
 *   failure → { success: false, error: string }
 */

import { ipcMain, BrowserWindow } from 'electron'
import type { IPCResult } from '@intentos/shared-types'
import type { SkillRegistration } from '@intentos/shared-types'
import type { SkillManager } from '../modules/skill-manager'

export function registerSkillHandlers(skillManager: SkillManager): void {
  // skill:list — getInstalled() in preload
  ipcMain.handle(
    'skill:list',
    async (): Promise<IPCResult<SkillRegistration[]>> => {
      try {
        const data = skillManager.getInstalledSkills()
        return { success: true, data }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // skill:register — register() in preload
  ipcMain.handle(
    'skill:register',
    async (_, { directoryPath }: { directoryPath: string }): Promise<IPCResult<SkillRegistration>> => {
      try {
        const data = skillManager.registerSkill(directoryPath)
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('skill-manager:changed', {
              type: 'registered',
              skillId: data.id,
              timestamp: Date.now(),
            })
          }
        })
        return { success: true, data }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // skill:unregister — unregister() in preload
  ipcMain.handle(
    'skill:unregister',
    async (_, { skillId }: { skillId: string }): Promise<IPCResult<void>> => {
      try {
        skillManager.unregisterSkill(skillId)
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('skill-manager:changed', {
              type: 'unregistered',
              skillId,
              timestamp: Date.now(),
            })
          }
        })
        return { success: true, data: undefined }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // skill:get — getById() in preload
  ipcMain.handle(
    'skill:get',
    async (_, { skillId }: { skillId: string }): Promise<IPCResult<SkillRegistration | null>> => {
      try {
        const data = skillManager.getSkillById(skillId)
        return { success: true, data }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // skill:check-dependencies — checkDependencies() in preload
  ipcMain.handle(
    'skill:check-dependencies',
    async (
      _,
      { skillId }: { skillId: string },
    ): Promise<IPCResult<{ hasApps: boolean; appNames: string[] }>> => {
      try {
        const data = skillManager.checkDependencies(skillId)
        return { success: true, data }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}
