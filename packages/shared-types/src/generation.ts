import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const PlanModuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  filePath: z.string().min(1),
});

export const SkillUsageSchema = z.object({
  skillId: z.string().min(1),
  methods: z.array(z.string()),
});

export const PlanResultSchema = z.object({
  appName: z.string().min(1),
  description: z.string().min(1),
  modules: z.array(PlanModuleSchema),
  skillUsage: z.array(SkillUsageSchema),
});

export const PlanChunkSchema = z.object({
  sessionId: z.string().min(1),
  phase: z.enum(["planning", "complete", "error"]),
  content: z.string(),
  planResult: PlanResultSchema.optional(),
});

export const GenProgressChunkSchema = z.object({
  sessionId: z.string().min(1),
  stage: z.enum(["codegen", "compile", "bundle", "complete", "error"]),
  /** Progress percentage 0-100 */
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  filePath: z.string().optional(),
});

export const GenCompleteChunkSchema = GenProgressChunkSchema.extend({
  stage: z.literal("complete"),
  entryPoint: z.string().min(1),
  outputDir: z.string().min(1),
});

// ── TypeScript Types (inferred from Zod schemas) ──────────────────────────────

export type PlanModule = z.infer<typeof PlanModuleSchema>;
export type SkillUsage = z.infer<typeof SkillUsageSchema>;
export type PlanResult = z.infer<typeof PlanResultSchema>;
export type PlanChunk = z.infer<typeof PlanChunkSchema>;
export type GenProgressChunk = z.infer<typeof GenProgressChunkSchema>;
export type GenCompleteChunk = z.infer<typeof GenCompleteChunkSchema>;
