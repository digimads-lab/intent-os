import type { SkillRegistration, ProviderStatus, ProviderConfig, CustomProviderConfig, PlanChunk, GenProgressChunk, AppRegistration, AppStatusChanged, PipelineStatus } from '@intentos/shared-types'

// Inline the API shapes to avoid importing from preload (which pulls in Electron internals
// not available in the renderer tsconfig).

interface SkillAPIShape {
  getInstalled: () => Promise<SkillRegistration[]>
  register: (directoryPath: string) => Promise<SkillRegistration>
  unregister: (skillId: string) => Promise<void>
  getById: (skillId: string) => Promise<SkillRegistration | null>
  checkDependencies: (skillId: string) => Promise<{ hasApps: boolean; appNames: string[] }>
  onChanged: (
    cb: (event: {
      type: 'added' | 'removed' | 'updated'
      skillId: string
      meta: SkillRegistration
      timestamp: string
    }) => void,
  ) => () => void
}

interface AIProviderAPIShape {
  getStatus: () => Promise<ProviderStatus>
  onStatusChanged: (cb: (status: ProviderStatus) => void) => () => void
  plan: (payload: unknown) => Promise<string>
  onPlanChunk: (sessionId: string, cb: (chunk: unknown) => void) => () => void
  onPlanComplete: (sessionId: string, cb: () => void) => () => void
  onPlanError: (sessionId: string, cb: (err: { code: string; message: string }) => void) => () => void
  generate: (payload: unknown) => Promise<string>
  onGenProgress: (sessionId: string, cb: (chunk: unknown) => void) => () => void
  onGenComplete: (sessionId: string, cb: (chunk: unknown) => void) => () => void
  onGenError: (sessionId: string, cb: (err: { code: string; message: string }) => void) => () => void
  cancelSession: (sessionId: string) => Promise<void>
}

interface SettingsAPIShape {
  saveApiKey: (apiKey: string, providerId?: string) => Promise<void>
  getApiKey: (providerId?: string) => Promise<{ key: string | null; configured: boolean }>
  testConnection: () => Promise<{ success: boolean; latencyMs?: number; providerName?: string; error?: string }>
  getProviderConfig: () => Promise<ProviderConfig | null>
  setProviderConfig: (config: ProviderConfig) => Promise<void>
  getConnectionStatus: () => Promise<ProviderStatus>
  setProvider: (config: { providerId: string; config?: ProviderConfig }) => Promise<{ success: boolean; error?: { code: string; message: string } }>
  getCustomProviderConfig: () => Promise<{ config: CustomProviderConfig | null; hasApiKey: boolean }>
  setCustomProviderConfig: (payload: {
    baseUrl: string
    planModel: string
    codegenModel: string
    apiKey?: string | undefined
    clearApiKey?: boolean | undefined
  }) => Promise<{ success: boolean; error?: { code: string; message: string } }>
}

interface AppAPIShape {
  getAll: () => Promise<AppRegistration[]>
  launch: (appId: string) => Promise<void>
  stop: (appId: string) => Promise<void>
  uninstall: (appId: string) => Promise<void>
  focus: (appId: string) => Promise<void>
  onStatusChanged: (cb: (event: AppStatusChanged) => void) => () => void
}

interface GenerationAPIShape {
  startPlan: (payload: { skillIds: string[]; intent: string }) => Promise<{ sessionId: string; status: string }>
  refinePlan: (payload: { sessionId: string; feedback: string }) => Promise<void>
  confirmAndGenerate: (payload: { sessionId: string; appName: string }) => Promise<{ sessionId: string; status: string }>
  requestMock: (payload: { sessionId: string }) => Promise<void>
  reviseMock: (payload: { sessionId: string; feedback: string }) => Promise<void>
  approveMock: (payload: { sessionId: string }) => Promise<void>
  startPipeline: (payload: { sessionId: string; appName: string }) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
  onPlanChunk: (sessionId: string, cb: (chunk: PlanChunk) => void) => () => void
  onGenProgress: (sessionId: string, cb: (chunk: GenProgressChunk) => void) => () => void
  onMockHtml: (sessionId: string, cb: (data: { html: string; isPartial: boolean }) => void) => () => void
  onPipelineStatus: (sessionId: string, cb: (status: PipelineStatus) => void) => () => void
}

interface ModificationAPIShape {
  start: (appId: string, requirement: string) => Promise<{ sessionId: string; status: string }>
  confirm: (sessionId: string) => Promise<{ status: string }>
  cancel: (sessionId: string) => Promise<{ success: boolean }>
  onPlanChunk: (sessionId: string, cb: (chunk: unknown) => void) => () => void
  onProgress: (sessionId: string, cb: (progress: unknown) => void) => () => void
  onError: (sessionId: string, cb: (error: { code: string; message: string }) => void) => () => void
}

interface OnboardingAPIShape {
  check: () => Promise<{ needed: boolean }>
  complete: () => Promise<{ success: boolean }>
}

declare global {
  interface Window {
    intentOS: {
      skill: SkillAPIShape
      aiProvider: AIProviderAPIShape
      settings: SettingsAPIShape
      app: AppAPIShape
      generation: GenerationAPIShape
      modification: ModificationAPIShape
      onboarding: OnboardingAPIShape
    }
  }
}

export {}
