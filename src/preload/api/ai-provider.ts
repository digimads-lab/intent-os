import { ipcRenderer } from 'electron'
import type { PlanChunk, GenProgressChunk, ProviderStatus } from '@intentos/shared-types'
import type { PlanRequest, GenerateRequest } from '../../main/modules/ai-provider/interfaces'

export const aiProviderAPI = {
  // 发起规划（返回 sessionId）
  plan: (payload: PlanRequest): Promise<string> =>
    ipcRenderer.invoke('ai-provider:plan', payload),

  // 订阅规划 chunk（返回取消订阅函数）
  onPlanChunk: (sessionId: string, cb: (chunk: PlanChunk) => void): (() => void) => {
    const channel = `ai-provider:plan-chunk:${sessionId}`
    const handler = (_e: unknown, chunk: PlanChunk) => cb(chunk)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 订阅规划完成
  onPlanComplete: (sessionId: string, cb: () => void): (() => void) => {
    const channel = `ai-provider:plan-complete:${sessionId}`
    const handler = () => cb()
    ipcRenderer.once(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 订阅规划错误
  onPlanError: (
    sessionId: string,
    cb: (err: { code: string; message: string }) => void,
  ): (() => void) => {
    const channel = `ai-provider:plan-error:${sessionId}`
    const handler = (_e: unknown, err: { code: string; message: string }) => cb(err)
    ipcRenderer.once(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 发起代码生成
  generate: (payload: GenerateRequest): Promise<string> =>
    ipcRenderer.invoke('ai-provider:generate', payload),

  // 订阅生成进度
  onGenProgress: (sessionId: string, cb: (chunk: GenProgressChunk) => void): (() => void) => {
    const channel = `ai-provider:gen-progress:${sessionId}`
    const handler = (_e: unknown, chunk: GenProgressChunk) => cb(chunk)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 订阅生成完成
  onGenComplete: (sessionId: string, cb: (chunk: GenProgressChunk) => void): (() => void) => {
    const channel = `ai-provider:gen-complete:${sessionId}`
    const handler = (_e: unknown, chunk: GenProgressChunk) => cb(chunk)
    ipcRenderer.once(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 订阅生成错误
  onGenError: (
    sessionId: string,
    cb: (err: { code: string; message: string }) => void,
  ): (() => void) => {
    const channel = `ai-provider:gen-error:${sessionId}`
    const handler = (_e: unknown, err: { code: string; message: string }) => cb(err)
    ipcRenderer.once(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  // 取消会话
  cancelSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('ai-provider:cancel', { sessionId }),

  // 查询状态
  getStatus: (): Promise<ProviderStatus> => ipcRenderer.invoke('ai-provider:status'),

  // 订阅状态变更（全局广播）
  onStatusChanged: (cb: (status: ProviderStatus) => void): (() => void) => {
    const handler = (_e: unknown, status: ProviderStatus) => cb(status)
    ipcRenderer.on('ai-provider:status-changed', handler)
    return () => ipcRenderer.removeListener('ai-provider:status-changed', handler)
  },
}

export type AIProviderAPI = typeof aiProviderAPI
