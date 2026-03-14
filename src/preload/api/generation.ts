import { ipcRenderer } from 'electron'
import type { PlanChunk, GenProgressChunk } from '@intentos/shared-types'

export const generationAPI = {
  // 从 Skill + 意图启动规划
  startPlan: (payload: { skillIds: string[]; intent: string; sessionId: string }): Promise<{ sessionId: string; status: string }> =>
    ipcRenderer.invoke('generation:start-plan', payload),

  // 多轮规划（追加反馈）
  refinePlan: (payload: { sessionId: string; feedback: string }): Promise<void> =>
    ipcRenderer.invoke('generation:refine-plan', payload),

  // 确认方案并开始生成
  confirmAndGenerate: (payload: { sessionId: string; appName: string }): Promise<{ sessionId: string; status: string }> =>
    ipcRenderer.invoke('generation:confirm-generate', payload),

  // 取消生成
  cancel: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('generation:cancel', { sessionId }),

  // 订阅规划 chunk
  onPlanChunk: (sessionId: string, cb: (chunk: PlanChunk) => void): (() => void) => {
    const channel = `ai-provider:plan-chunk:${sessionId}`
    const handler = (_e: unknown, chunk: PlanChunk) => cb(chunk)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 订阅生成进度
  onGenProgress: (sessionId: string, cb: (chunk: GenProgressChunk) => void): (() => void) => {
    const channel = `ai-provider:gen-progress:${sessionId}`
    const handler = (_e: unknown, chunk: GenProgressChunk) => cb(chunk)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

export type GenerationAPI = typeof generationAPI
