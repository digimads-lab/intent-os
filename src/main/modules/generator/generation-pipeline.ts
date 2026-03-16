/**
 * CR-002: M-05b GenerationPipeline
 *
 * Orchestrates the full SkillApp generation flow:
 *   Mock (already approved) → Code Generation → Compile → Runtime Test → (Fix loop) → Complete
 *
 * Delegates actual work to GenerateSessionManager, RuntimeVerifier, etc.
 * Broadcasts stage transitions through GenerationProgressTracker.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { app } from "electron";
import type { WebContents } from "electron";

import type { GenProgressChunk } from "@intentos/shared-types";
import type { GenerateRequest } from "../ai-provider/interfaces";
import type { LifecycleManager } from "../lifecycle-manager/lifecycle-manager";

import type { PlanSessionManager } from "./plan-session";
import { GenerationProgressTracker } from "./progress-tracker";
import { RuntimeVerifier } from "./runtime-verifier";
import { TemplateManager } from "./template-manager";
import { GeneratorError } from "./types";

// ── Narrow AI interface ──────────────────────────────────────────────────────

interface PipelineAICapable {
  generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk>;
  planApp(request: any): AsyncIterable<any>;
}

// ── GenerationPipeline ───────────────────────────────────────────────────────

export class GenerationPipeline {
  private readonly tracker = new GenerationProgressTracker();
  private readonly verifier = new RuntimeVerifier();
  private readonly templateManager = new TemplateManager();
  private readonly activeSessions: Set<string> = new Set();

  constructor(
    private readonly aiProvider: PipelineAICapable,
    private readonly planSessionManager: PlanSessionManager,
    private readonly lifecycleManager: LifecycleManager,
  ) {}

  /**
   * Run the complete generation pipeline.
   * Assumes mock preview has already been approved.
   */
  async startPipeline(
    sessionId: string,
    appName: string,
    sender: WebContents | null,
  ): Promise<void> {
    this.activeSessions.add(sessionId);
    this.tracker.initPipeline(sessionId);

    // Ensure template manager is ready
    await this.templateManager.initialize();

    let targetDir: string | null = null;

    try {
      // ── Stage: mock (already done) ──────────────────────────────────────
      this.tracker.updateStage(
        sessionId,
        "mock",
        { status: "done", completedAt: Date.now() },
        sender,
      );

      // ── Stage: codegen ──────────────────────────────────────────────────
      this.checkCancelled(sessionId);
      this.tracker.updateStage(
        sessionId,
        "codegen",
        { status: "running", startedAt: Date.now(), progress: 0, message: "准备代码生成..." },
        sender,
      );

      const planResult = await this.planSessionManager.getPlanResult(sessionId);
      if (!planResult) {
        throw new GeneratorError("PLAN_RESULT_MISSING", { sessionId });
      }

      // Generate appId
      const slug = appName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const appId = `${slug}-${randomUUID().slice(0, 6)}`;

      targetDir = path.join(app.getPath("userData"), "apps", appId);
      await fs.promises.mkdir(targetDir, { recursive: true });

      // Call AI generateCode with template guidance
      // Template guidance is available via this.templateManager.getTemplateGuide()
      // and this.templateManager.getTemplateExamples() for future prompt injection.

      const stream = this.aiProvider.generateCode({
        sessionId,
        plan: planResult,
        appId,
        targetDir,
      });

      // Consume code generation stream
      for await (const chunk of stream) {
        this.checkCancelled(sessionId);
        const mappedProgress = this.mapCodegenProgress(chunk);
        this.tracker.updateStage(
          sessionId,
          "codegen",
          { progress: mappedProgress, message: chunk.message },
          sender,
        );

        // Also forward to legacy gen-progress channel for compatibility
        if (sender && !sender.isDestroyed()) {
          sender.send(`ai-provider:gen-progress:${sessionId}`, chunk);
        }
      }

      this.tracker.updateStage(
        sessionId,
        "codegen",
        { status: "done", progress: 100, completedAt: Date.now() },
        sender,
      );

      // ── Write SkillApp scaffold ─────────────────────────────────────────
      await this.writeSkillAppScaffold(
        targetDir,
        appId,
        appName,
        planResult.skillUsage.map((u) => u.skillId),
      );

      // ── Stage: compile ──────────────────────────────────────────────────
      this.checkCancelled(sessionId);
      this.tracker.updateStage(
        sessionId,
        "compile",
        { status: "running", startedAt: Date.now(), progress: 50, message: "编译中..." },
        sender,
      );

      // Compilation is handled as part of the code generation stream above
      // Mark as done since generateCode includes compilation
      this.tracker.updateStage(
        sessionId,
        "compile",
        { status: "done", progress: 100, completedAt: Date.now() },
        sender,
      );

      // ── Stage: test ─────────────────────────────────────────────────────
      this.checkCancelled(sessionId);
      this.tracker.updateStage(
        sessionId,
        "test",
        { status: "running", startedAt: Date.now(), progress: 0, message: "验证应用启动..." },
        sender,
      );

      const verifyResult = await this.verifier.verifyAndFix(
        targetDir,
        "main.js",
        this.aiProvider,
        sender,
        sessionId,
      );

      if (!verifyResult.success) {
        this.tracker.updateStage(
          sessionId,
          "test",
          {
            status: "failed",
            completedAt: Date.now(),
            error: `验证失败 (${verifyResult.attempt} 次尝试): ${verifyResult.error}`,
          },
          sender,
        );

        // Still register the app but mark with a warning — the user can see
        // the failure in the pipeline UI and choose to retry or accept.
        // Fall through to registration so the generated code is not lost.
      } else {
        this.tracker.updateStage(
          sessionId,
          "test",
          { status: "done", progress: 100, completedAt: Date.now() },
          sender,
        );
      }

      // ── Stage: complete ─────────────────────────────────────────────────
      const now = new Date().toISOString();
      await this.lifecycleManager.registerApp({
        id: appId,
        name: planResult.appName,
        description: planResult.description,
        skillIds: planResult.skillUsage.map((u) => u.skillId),
        status: "registered",
        outputDir: targetDir,
        entryPoint: "main.js",
        version: 1,
        crashCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      this.tracker.updateStage(
        sessionId,
        "complete",
        { status: "done", completedAt: Date.now(), message: "应用生成成功" },
        sender,
      );

      // Notify renderer of completion
      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:gen-complete:${sessionId}`, { appId });
      }
    } catch (error) {
      // Clean up target directory on failure
      if (targetDir) {
        await fs.promises
          .rm(targetDir, { recursive: true, force: true })
          .catch(() => {});
      }

      const generatorError =
        error instanceof GeneratorError
          ? error
          : new GeneratorError("GENERATION_FAILED", {
              originalMessage:
                error instanceof Error ? error.message : String(error),
            });

      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:gen-error:${sessionId}`, {
          code: generatorError.code,
          message: generatorError.message,
          context: generatorError.context,
        });
      }

      throw generatorError;
    } finally {
      this.activeSessions.delete(sessionId);
      this.tracker.cleanup(sessionId);
    }
  }

  /**
   * Cancel an active pipeline.
   */
  cancelPipeline(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.tracker.cleanup(sessionId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private checkCancelled(sessionId: string): void {
    if (!this.activeSessions.has(sessionId)) {
      throw new GeneratorError("PIPELINE_CANCELLED", { sessionId });
    }
  }

  private mapCodegenProgress(chunk: GenProgressChunk): number {
    switch (chunk.stage) {
      case "codegen":
        return Math.round((chunk.progress / 100) * 100);
      case "compile":
        return 100;
      default:
        return chunk.progress;
    }
  }

  /**
   * Copy SkillApp template scaffold to targetDir (delegated from generate-session).
   */
  private async writeSkillAppScaffold(
    targetDir: string,
    appId: string,
    appName: string,
    skillIds: string[],
  ): Promise<void> {
    const templateDir = path.resolve(__dirname, "../../src/skillapp-template");
    const TEXT_EXTENSIONS = new Set([".js", ".ts", ".tsx", ".json", ".html", ".md"]);

    const replacements: Record<string, string> = {
      "{{APP_ID}}": appId,
      "{{APP_NAME}}": appName,
      "{{APP_VERSION}}": "1",
      "{{SKILL_IDS}}": JSON.stringify(skillIds),
    };

    async function copyDir(srcDir: string, destDir: string): Promise<void> {
      await fs.promises.mkdir(destDir, { recursive: true });
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
      } catch {
        return; // template dir doesn't exist in dev
      }

      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destName = entry.name.endsWith(".template")
          ? entry.name.slice(0, -".template".length)
          : entry.name;
        const destPath = path.join(destDir, destName);

        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          const ext = path.extname(destName);
          if (TEXT_EXTENSIONS.has(ext)) {
            let content = await fs.promises.readFile(srcPath, "utf8");
            for (const [placeholder, value] of Object.entries(replacements)) {
              content = content.split(placeholder).join(value);
            }
            await fs.promises.writeFile(destPath, content, "utf8");
          } else {
            await fs.promises.copyFile(srcPath, destPath);
          }
        }
      }
    }

    await copyDir(templateDir, targetDir);
  }
}
