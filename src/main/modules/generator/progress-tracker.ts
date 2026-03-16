/**
 * CR-002: M-05d GenerationProgressTracker
 *
 * Tracks and broadcasts pipeline stage status changes to the renderer
 * via IPC events.
 */

import type { WebContents } from "electron";

import type {
  PipelineStageId,
  PipelineStageInfo,
  PipelineStatus,
} from "@intentos/shared-types";

// ── Progress weight map ──────────────────────────────────────────────────────

const STAGE_WEIGHTS: Record<PipelineStageId, [number, number]> = {
  mock: [0, 15],
  codegen: [15, 50],
  compile: [50, 70],
  test: [70, 90],
  fix: [70, 90], // fix reuses test's progress range
  complete: [90, 100],
};

// ── Default stage list ───────────────────────────────────────────────────────

function createDefaultStages(): PipelineStageInfo[] {
  return [
    { id: "mock", label: "Mock 预览", status: "done" }, // already approved before pipeline starts
    { id: "codegen", label: "代码生成", status: "waiting" },
    { id: "compile", label: "编译", status: "waiting" },
    { id: "test", label: "运行测试", status: "waiting" },
    { id: "complete", label: "完成", status: "waiting" },
  ];
}

// ── GenerationProgressTracker ────────────────────────────────────────────────

export class GenerationProgressTracker {
  private readonly pipelines: Map<string, PipelineStageInfo[]> = new Map();

  /**
   * Initialise a new pipeline for the given session.
   */
  initPipeline(sessionId: string): void {
    this.pipelines.set(sessionId, createDefaultStages());
  }

  /**
   * Update a stage and broadcast the new status via IPC.
   */
  updateStage(
    sessionId: string,
    stageId: PipelineStageId,
    update: Partial<PipelineStageInfo>,
    sender: WebContents | null,
  ): void {
    const stages = this.pipelines.get(sessionId);
    if (!stages) return;

    // If we're entering the 'fix' stage, insert it before 'complete' if not already present
    if (stageId === "fix" && !stages.find((s) => s.id === "fix")) {
      const completeIdx = stages.findIndex((s) => s.id === "complete");
      if (completeIdx >= 0) {
        stages.splice(completeIdx, 0, {
          id: "fix",
          label: "AI 修复",
          status: "waiting",
        });
      }
    }

    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    Object.assign(stage, update);

    const status = this.buildStatus(sessionId, stages, stageId);

    if (sender && !sender.isDestroyed()) {
      sender.send(`generation:pipeline-status:${sessionId}`, status);
    }
  }

  /**
   * Get the current pipeline status.
   */
  getStatus(sessionId: string): PipelineStatus | null {
    const stages = this.pipelines.get(sessionId);
    if (!stages) return null;

    const current = stages.find((s) => s.status === "running")?.id ?? "complete";
    return this.buildStatus(sessionId, stages, current);
  }

  /**
   * Clean up pipeline state for a session.
   */
  cleanup(sessionId: string): void {
    this.pipelines.delete(sessionId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildStatus(
    sessionId: string,
    stages: PipelineStageInfo[],
    currentStage: PipelineStageId,
  ): PipelineStatus {
    return {
      sessionId,
      stages: stages.map((s) => ({ ...s })),
      currentStage,
      overallProgress: this.calculateOverallProgress(stages),
    };
  }

  private calculateOverallProgress(stages: PipelineStageInfo[]): number {
    let total = 0;
    for (const stage of stages) {
      const [lo, hi] = STAGE_WEIGHTS[stage.id] ?? [0, 0];
      if (stage.status === "done" || stage.status === "skipped") {
        total = Math.max(total, hi);
      } else if (stage.status === "running" && stage.progress != null) {
        total = Math.max(total, lo + (stage.progress / 100) * (hi - lo));
      }
    }
    return Math.round(total);
  }
}
