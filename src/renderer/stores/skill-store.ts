import { create } from 'zustand'
import type { SkillRegistration } from '@intentos/shared-types'

interface SkillStore {
  skills: SkillRegistration[]
  loading: boolean
  error: string | null
  fetchSkills: () => Promise<void>
  registerSkill: (directoryPath: string) => Promise<void>
  unregisterSkill: (skillId: string) => Promise<void>
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  loading: false,
  error: null,

  fetchSkills: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.intentOS.skill.getInstalled()
      set({ skills: result, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  registerSkill: async (directoryPath: string) => {
    set({ error: null })
    try {
      await window.intentOS.skill.register(directoryPath)
      await get().fetchSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  unregisterSkill: async (skillId: string) => {
    set({ error: null })
    try {
      await window.intentOS.skill.unregister(skillId)
      await get().fetchSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },
}))
