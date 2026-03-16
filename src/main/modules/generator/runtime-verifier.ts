/**
 * CR-002: M-05c RuntimeVerifier
 *
 * After compilation succeeds, spawns the generated SkillApp in test mode
 * to verify it can start successfully. On failure, collects error logs
 * and requests AI-powered fixes, retrying up to MAX_VERIFY_ATTEMPTS times.
 */

import { spawn } from "child_process";
import path from "path";

import type { WebContents } from "electron";

import type { PlanChunk } from "@intentos/shared-types";
import type { PlanRequest } from "../ai-provider/interfaces";

// ── Narrow AI interface ──────────────────────────────────────────────────────

interface FixCapable {
  planApp(request: PlanRequest): AsyncIterable<PlanChunk>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RuntimeVerifyResult {
  success: boolean;
  attempt: number;
  error?: string;
  logs?: string;
  exitCode?: number;
}

// ── RuntimeVerifier ──────────────────────────────────────────────────────────

export class RuntimeVerifier {
  private static readonly STARTUP_TIMEOUT_MS = 10_000;
  private static readonly MAX_VERIFY_ATTEMPTS = 3;

  /**
   * Verify the generated SkillApp can start, retrying with AI fixes on failure.
   */
  async verifyAndFix(
    appDir: string,
    entryPoint: string,
    aiProvider: FixCapable,
    sender: WebContents | null,
    sessionId: string,
  ): Promise<RuntimeVerifyResult> {
    for (
      let attempt = 1;
      attempt <= RuntimeVerifier.MAX_VERIFY_ATTEMPTS;
      attempt++
    ) {
      const result = await this.spawnAndVerify(appDir, entryPoint);

      if (result.success) {
        return { success: true, attempt };
      }

      // Last attempt — do not try to fix
      if (attempt >= RuntimeVerifier.MAX_VERIFY_ATTEMPTS) {
        return {
          success: false,
          attempt,
          error: result.error ?? "Unknown error",
          logs: result.logs ?? "",
          exitCode: result.exitCode ?? 1,
        };
      }

      // Notify UI about the fix attempt
      if (sender && !sender.isDestroyed()) {
        sender.send(`generation:pipeline-status:${sessionId}`, {
          stage: "fix",
          status: "running",
          message: `第 ${attempt} 次验证失败，AI 正在修复...`,
        });
      }

      // Ask AI to fix the runtime error
      await this.aiFixCode(appDir, result.error ?? "", result.logs ?? "", aiProvider, sessionId);

      // Recompile after fix
      await this.recompile(appDir);
    }

    return {
      success: false,
      attempt: RuntimeVerifier.MAX_VERIFY_ATTEMPTS,
      error: "MAX_VERIFY_ATTEMPTS_EXCEEDED",
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Spawn the SkillApp in test mode and wait for the INTENTOS_READY signal.
   */
  private spawnAndVerify(
    appDir: string,
    entryPoint: string,
  ): Promise<RuntimeVerifyResult> {
    return new Promise((resolve) => {
      const entryPath = path.join(appDir, entryPoint);

      const proc = spawn("electron", [entryPath], {
        cwd: appDir,
        env: {
          ...process.env,
          INTENTOS_TEST_MODE: "1",
          ELECTRON_RUN_AS_NODE: undefined, // ensure electron runs as electron
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (result: RuntimeVerifyResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Kill the process if still running
        try {
          proc.kill();
        } catch {
          // already exited
        }
        resolve(result);
      };

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.includes("INTENTOS_READY")) {
          settle({ success: true, attempt: 0 });
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (exitCode: number | null) => {
        settle({
          success: false,
          attempt: 0,
          error: `Process exited with code ${exitCode}`,
          logs: stderr || stdout,
          exitCode: exitCode ?? 1,
        });
      });

      proc.on("error", (err: Error) => {
        settle({
          success: false,
          attempt: 0,
          error: err.message,
          logs: stderr,
        });
      });

      // Timeout
      const timer = setTimeout(() => {
        settle({
          success: false,
          attempt: 0,
          error: `Startup timeout (${RuntimeVerifier.STARTUP_TIMEOUT_MS}ms)`,
          logs: stderr || stdout,
        });
      }, RuntimeVerifier.STARTUP_TIMEOUT_MS);
    });
  }

  /**
   * Send error logs to AI for analysis and fix suggestions.
   */
  private async aiFixCode(
    appDir: string,
    error: string,
    logs: string,
    aiProvider: FixCapable,
    sessionId: string,
  ): Promise<void> {
    const prompt = `以下 SkillApp 启动时出错，请分析错误并修复代码。

## 错误信息
${error}

## 启动日志
${logs}

请直接返回修复后的完整文件内容，格式如下：
// FILE: {filePath}
{修复后内容}`;

    const request: PlanRequest = {
      sessionId: `runtime-fix-${sessionId}-${Date.now()}`,
      intent: prompt,
      skills: [],
      contextHistory: [],
    };

    const stream = aiProvider.planApp(request);
    let accumulated = "";
    for await (const chunk of stream) {
      if (chunk.content) {
        accumulated += chunk.content;
      }
    }

    // Parse and write fixed files (reuse CompileFixer's file parsing pattern)
    const files = parseFixedFiles(accumulated);
    const fs = await import("fs");
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(appDir, filePath);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content, "utf-8");
    }
  }

  /**
   * Re-run tsc compilation after a fix.
   */
  private async recompile(appDir: string): Promise<void> {
    // Just run tsc; if it fails, the next verify cycle will catch it
    await new Promise<void>((resolve) => {
      const proc = spawn("npx", ["tsc", "--noEmit"], {
        cwd: appDir,
        shell: false,
      });
      proc.on("close", () => resolve());
      proc.on("error", () => resolve());
    });
  }
}

// ── Shared file parser ───────────────────────────────────────────────────────

function parseFixedFiles(responseText: string): Record<string, string> {
  const result: Record<string, string> = {};
  const filePattern = /^\/\/ FILE:\s+(.+)$/gm;
  const matches = [...responseText.matchAll(filePattern)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const filePath = match[1].trim();
    const startIndex = (match.index ?? 0) + match[0].length + 1;
    const endIndex =
      i + 1 < matches.length
        ? matches[i + 1].index ?? responseText.length
        : responseText.length;
    const content = responseText.slice(startIndex, endIndex).trimEnd();
    result[filePath] = content;
  }

  return result;
}
