// @intentos/shared-types
// Shared TypeScript types and Zod schemas for IntentOS

// ── Skill ─────────────────────────────────────────────────────────────────────
export {
  SkillMetaSchema,
  SkillManifestSchema,
  SkillStatusSchema,
  SkillRegistrationSchema,
} from "./skill.js";
export type {
  SkillMeta,
  SkillManifest,
  SkillStatus,
  SkillRegistration,
} from "./skill.js";

// ── App ───────────────────────────────────────────────────────────────────────
export {
  AppStatusSchema,
  AppMetaSchema,
  AppRegistrationSchema,
  AppStatusChangedSchema,
} from "./app.js";
export type {
  AppStatus,
  AppMeta,
  AppRegistration,
  AppStatusChanged,
} from "./app.js";

// ── Generation ────────────────────────────────────────────────────────────────
export {
  PlanModuleSchema,
  SkillUsageSchema,
  PlanResultSchema,
  PlanChunkSchema,
  GenProgressChunkSchema,
  GenCompleteChunkSchema,
} from "./generation.js";
export type {
  PlanModule,
  SkillUsage,
  PlanResult,
  PlanChunk,
  GenProgressChunk,
  GenCompleteChunk,
} from "./generation.js";

// ── Provider ──────────────────────────────────────────────────────────────────
export {
  ProviderStatusSchema,
  ProviderTypeSchema,
  ProviderConfigSchema,
  ClaudeProviderConfigSchema,
  CustomProviderConfigSchema,
  OpenClawProviderConfigSchema,
  ProviderErrorCodeSchema,
  ProviderErrorSchema,
} from "./provider.js";
export type {
  ProviderStatus,
  ProviderType,
  ProviderConfig,
  ClaudeProviderConfig,
  CustomProviderConfig,
  OpenClawProviderConfig,
  ProviderErrorCode,
  ProviderError,
} from "./provider.js";

// ── IPC ───────────────────────────────────────────────────────────────────────
export {
  IPCResultSuccessSchema,
  IPCResultFailureSchema,
  ConnectionStatusSchema,
} from "./ipc.js";
export type { IPCResult, ConnectionStatus } from "./ipc.js";

// ── Update ────────────────────────────────────────────────────────────────────
export { UpdatePackageSchema } from "./update.js";
export type { UpdatePackage } from "./update.js";
