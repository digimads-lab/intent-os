/**
 * M-05 SkillApp 生成器 — 模块公开入口
 *
 * 导出 generator 模块的所有公开类和类型，供其他模块按需导入。
 */

export { PlanSessionManager } from './plan-session'
export { GenerateSessionManager } from './generate-session'
export { CompileFixer } from './compile-fixer'
export { ModifySessionManager, createModifySessionManager } from './modify-session'
export { confirmAndApplyModify } from './modify-generate'
export { MockPreviewGenerator } from './mock-preview'
export { GenerationPipeline } from './generation-pipeline'
export { RuntimeVerifier } from './runtime-verifier'
export { TemplateManager } from './template-manager'
export { GenerationProgressTracker } from './progress-tracker'
export { GeneratorError } from './types'
export type {
  StartPlanRequest,
  PlanResult,
  PlanModule,
  SkillUsageItem,
  CompileError,
  CompileFixResult,
  GeneratorErrorCode,
  ModifyPlan,
  ModuleChange,
} from './types'
