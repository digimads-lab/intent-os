import { create } from 'zustand'
import type { ProviderStatus } from '@intentos/shared-types'

interface ProviderStore {
  status: ProviderStatus
  setStatus: (status: ProviderStatus) => void
  initStatusListener: () => () => void
}

export const useProviderStore = create<ProviderStore>((set) => ({
  status: 'uninitialized',
  setStatus: (status) => set({ status }),
  initStatusListener: () => {
    const unsub = window.intentOS.aiProvider.onStatusChanged((status) => {
      set({ status })
    })
    window.intentOS.aiProvider
      .getStatus()
      .then((s) => set({ status: s }))
      .catch(() => {})
    return unsub
  },
}))
