import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const ProviderStatusSchema = z.enum([
  "uninitialized",
  "initializing",
  "ready",
  "error",
  "rate_limited",
  "disposing",
]);

export const ProviderTypeSchema = z.enum(["claude-api", "custom", "openclaw"]);

// ── ProviderConfig: discriminated union (CR-001) ─────────────────────────────

export const ClaudeProviderConfigSchema = z.object({
  providerId: z.literal("claude-api"),
  claudeApiKey: z.string().optional(),
  claudeModel: z.string().optional(),
  claudeCodegenModel: z.string().optional(),
});

export const CustomProviderConfigSchema = z.object({
  providerId: z.literal("custom"),
  customBaseUrl: z.string().min(1),
  customPlanModel: z.string().min(1),
  customCodegenModel: z.string().min(1),
});

export const OpenClawProviderConfigSchema = z.object({
  providerId: z.literal("openclaw"),
  openclawHost: z.string().optional(),
  openclawPort: z.number().int().positive().optional(),
});

export const ProviderConfigSchema = z.discriminatedUnion("providerId", [
  ClaudeProviderConfigSchema,
  CustomProviderConfigSchema,
  OpenClawProviderConfigSchema,
]);

export const ProviderErrorCodeSchema = z.enum([
  "API_KEY_INVALID",
  "API_KEY_MISSING",
  "RATE_LIMITED",
  "NETWORK_UNAVAILABLE",
  "NETWORK_TIMEOUT",
  "PROVIDER_ERROR",
  "PLAN_FAILED",
  "CODEGEN_FAILED",
  "COMPILE_FAILED",
  "SESSION_CANCELLED",
  // CR-001: Custom Provider error codes
  "INVALID_BASE_URL",
  "MODEL_NOT_FOUND",
  "CUSTOM_PROVIDER_UNREACHABLE",
  "TOOL_CALL_UNSUPPORTED",
]);

export const ProviderErrorSchema = z.object({
  code: ProviderErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});

// ── TypeScript Types (inferred from Zod schemas) ──────────────────────────────

export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ClaudeProviderConfig = z.infer<typeof ClaudeProviderConfigSchema>;
export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;
export type OpenClawProviderConfig = z.infer<typeof OpenClawProviderConfigSchema>;
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;
