/**
 * M-05 SkillApp 生成器 — 生成会话管理器
 *
 * 职责：
 * - 从 PlanSessionManager 获取已确认的 PlanResult
 * - 调用 M-04 generateCode()，消费 GenProgressChunk 流
 * - 将进度事件映射为三段式进度（codegen 0-40% / compile 40-80% / bundle 80-100%）
 * - 将产物写入 userData/apps/{appId}/
 * - 生成完成后通知 M-03 注册新 App
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { app } from "electron";
import type { WebContents } from "electron";

import type { AIProvider } from "../ai-provider/interfaces";
import type { LifecycleManager } from "../lifecycle-manager/lifecycle-manager";
import type { PlanSessionManager } from "./plan-session";
import { GeneratorError } from "./types";

// ── GenerateSessionManager ────────────────────────────────────────────────────

/**
 * 生成会话管理器
 *
 * 用户确认规划方案后，负责驱动代码生成、进度上报和 App 注册全流程。
 */
export class GenerateSessionManager {
  constructor(
    private readonly aiProvider: AIProvider,
    private readonly planSessionManager: PlanSessionManager,
    private readonly lifecycleManager: LifecycleManager,
  ) {}

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 用户确认规划方案后，开始代码生成与打包。
   *
   * @param sessionId 规划阶段产生的 sessionId
   * @param appName 应用名称（用于生成 appId 和目录名）
   * @param sender 发起请求的渲染进程 WebContents（精确 IPC 路由，不广播）
   */
  async confirmAndGenerate(
    sessionId: string,
    appName: string,
    sender: WebContents | null,
  ): Promise<void> {
    let targetDir: string | null = null;

    try {
      // 1. 从 PlanSessionManager 获取 PlanResult
      const planResult =
        await this.planSessionManager.getPlanResult(sessionId);
      if (!planResult) {
        throw new GeneratorError("PLAN_RESULT_MISSING", { sessionId });
      }

      // 2. 生成 appId：slugify(appName) + '-' + randomUUID 前 6 位
      const slug = appName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const appId = `${slug}-${randomUUID().slice(0, 6)}`;

      // 3. 确定 targetDir 并创建目录
      targetDir = path.join(app.getPath("userData"), "apps", appId);
      await fs.promises.mkdir(targetDir, { recursive: true });

      // 4. 调用 M-04 generateCode()
      const stream = this.aiProvider.generateCode({
        sessionId,
        plan: planResult,
        appId,
        targetDir,
      });

      // 5. 消费 GenProgressChunk 流，映射进度并转发 IPC
      for await (const chunk of stream) {
        const mappedChunk = mapProgressChunk(chunk);
        if (sender && !sender.isDestroyed()) {
          sender.send(`ai-provider:gen-progress:${sessionId}`, mappedChunk);
        }
      }

      // 5.5. 将 SkillApp 模板复制到 targetDir
      await writeSkillAppScaffold(
        targetDir,
        appId,
        appName,
        planResult.skillUsage.map((u) => u.skillId),
      );

      // 6. 生成完成后调用 M-03 registerApp()
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

      // 7. 发送完成信号（只发 appId，不暴露服务器本地路径给渲染进程）
      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:gen-complete:${sessionId}`, { appId });
      }
    } catch (error) {
      // 清理已创建的目录
      if (targetDir) {
        await fs.promises.rm(targetDir, { recursive: true, force: true }).catch(
          () => {},
        );
      }

      // 将错误 wrap 为 GeneratorError 并通过 IPC 通知渲染进程
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
    }
  }
}

// ── SkillApp 模板复制 ─────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([".js", ".ts", ".tsx", ".json", ".html"]);

/**
 * 将 src/skillapp-template/ 下所有文件复制到 targetDir，替换模板占位符。
 * 文件名中 .template 后缀会被去掉。
 */
async function writeSkillAppScaffold(
  targetDir: string,
  appId: string,
  appName: string,
  skillIds: string[],
): Promise<void> {
  // 定位模板目录：开发时相对 __dirname，打包后相对 process.resourcesPath
  const templateDir = path.resolve(__dirname, "../../../../src/skillapp-template");

  const replacements: Record<string, string> = {
    "{{APP_ID}}": appId,
    "{{APP_NAME}}": appName,
    "{{APP_VERSION}}": "1",
    "{{SKILL_IDS}}": JSON.stringify(skillIds),
  };

  async function copyDir(srcDir: string, destDir: string): Promise<void> {
    await fs.promises.mkdir(destDir, { recursive: true });
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      // Strip .template suffix for destination filename
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

// ── 进度映射 ──────────────────────────────────────────────────────────────────

/**
 * 将 GenProgressChunk 的 stage/progress 字段映射到三段式进度区间：
 * - codegen: 0-40%
 * - compile: 40-80%
 * - bundle:  80-100%
 * - complete/error: 直接透传
 */
function mapProgressChunk(
  chunk: import("@intentos/shared-types").GenProgressChunk,
): import("@intentos/shared-types").GenProgressChunk {
  switch (chunk.stage) {
    case "codegen":
      return {
        ...chunk,
        // 将 chunk.progress（0-100）线性映射到 0-40%
        progress: Math.round((chunk.progress / 100) * 40),
      };
    case "compile":
      return {
        ...chunk,
        // 将 chunk.progress（0-100）线性映射到 40-80%
        progress: Math.round(40 + (chunk.progress / 100) * 40),
      };
    case "bundle":
      return {
        ...chunk,
        // 将 chunk.progress（0-100）线性映射到 80-100%
        progress: Math.round(80 + (chunk.progress / 100) * 20),
      };
    default:
      return chunk;
  }
}
