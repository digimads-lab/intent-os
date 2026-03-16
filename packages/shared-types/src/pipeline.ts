/**
 * CR-002: Generation Pipeline types
 *
 * Defines the multi-stage pipeline status model used for the optimised
 * SkillApp generation flow (Mock preview → codegen → compile → test → fix → complete).
 */

import { z } from "zod";

// ── Pipeline Stage ID ────────────────────────────────────────────────────────

export const PipelineStageIdSchema = z.enum([
  "mock",
  "codegen",
  "compile",
  "test",
  "fix",
  "complete",
]);
export type PipelineStageId = z.infer<typeof PipelineStageIdSchema>;

// ── Stage Status ─────────────────────────────────────────────────────────────

export const StageStatusSchema = z.enum([
  "waiting",
  "running",
  "done",
  "failed",
  "skipped",
]);
export type StageStatus = z.infer<typeof StageStatusSchema>;

// ── Pipeline Stage Info ──────────────────────────────────────────────────────

export const PipelineStageInfoSchema = z.object({
  id: PipelineStageIdSchema,
  label: z.string(),
  status: StageStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
});
export type PipelineStageInfo = z.infer<typeof PipelineStageInfoSchema>;

// ── Pipeline Status ──────────────────────────────────────────────────────────

export const PipelineStatusSchema = z.object({
  sessionId: z.string(),
  stages: z.array(PipelineStageInfoSchema),
  currentStage: PipelineStageIdSchema,
  overallProgress: z.number().min(0).max(100),
});
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;
