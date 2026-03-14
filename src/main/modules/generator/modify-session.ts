/**
 * M-05 SkillApp 生成器 — 增量修改会话管理器
 *
 * 职责：
 * - 读取现有 SkillApp 代码结构（扫描 src/app/ 目录）
 * - 调用 M-04 planApp() 生成增量修改方案（ModifyPlan）
 * - 返回分类结果：新增（added）/ 修改（modified）/ 不变（unchanged）
 * - 会话存储在内存 Map 中，30 分钟无操作后自动清理
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import type { WebContents } from "electron";

import type { AIProvider } from "../ai-provider/interfaces";
import {
  GeneratorError,
  type ModifyPlan,
  type ModuleChange,
} from "./types";

// ── 常量 ───────────────────────────────────────────────────────────────────────

/** 会话超时时长：30 分钟无操作后自动清理 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** 超时扫描间隔：每 5 分钟扫描一次 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 扫描代码文件时每个文件最多读取的首行数（用于摘要） */
const FILE_SUMMARY_LINES = 20;

// ── 内部类型 ───────────────────────────────────────────────────────────────────

/** ModifySession 内部状态 */
interface ModifySessionState {
  sessionId: string;
  appId: string;
  appDir: string;
  requirement: string;
  status: "planning" | "awaiting_confirmation" | "applying" | "complete" | "failed";
  modifyPlan: ModifyPlan | null;
  createdAt: number;
  lastActiveAt: number;
  /** 发起请求的渲染进程 WebContents（用于精确 IPC 路由，不广播） */
  sender: WebContents | null;
}

/** 扫描到的现有文件摘要 */
interface ExistingFile {
  /** 相对于 appDir 的路径，如 'src/app/pages/ImportPage.tsx' */
  path: string;
  /** 文件首若干行内容（用于向 AI 描述文件用途） */
  firstLines: string;
}

// ── ModifySessionManager ──────────────────────────────────────────────────────

/**
 * 增量修改会话管理器
 *
 * 分析现有 SkillApp 代码结构，调用 M-04 AI Provider 生成增量修改方案，
 * 只对 added/modified 模块触发后续 AI 代码生成，unchanged 模块不产生任何 AI 调用。
 */
export class ModifySessionManager {
  private readonly sessions: Map<string, ModifySessionState> = new Map();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly getAppDir: (appId: string) => Promise<string>,
  ) {
    this.cleanupTimer = this.startCleanupTimer();
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 启动增量修改会话。
   *
   * 流程：
   * 1. 确认 appDir 存在
   * 2. 扫描 src/app/ 目录，构建现有代码上下文
   * 3. 调用 M-04 planApp()（fire-and-forget），通过 IPC 流式推送 PlanChunk
   * 4. 解析 AI 返回的 PlanResult 为 ModifyPlan（added/modified/unchanged）
   *
   * @param appId     目标 SkillApp 的 appId
   * @param requirement 用户的修改需求描述
   * @param sender    发起请求的渲染进程 WebContents（用于精确 IPC 路由）
   * @returns 会话 ID
   */
  async startModifySession(
    appId: string,
    requirement: string,
    sender: WebContents | null = null,
  ): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    const appDir = await this.getAppDir(appId);

    // 校验 appDir 存在
    try {
      await fs.promises.access(appDir);
    } catch {
      throw new GeneratorError("APP_DIR_NOT_FOUND", { appId, appDir });
    }

    const now = Date.now();
    const session: ModifySessionState = {
      sessionId,
      appId,
      appDir,
      requirement,
      status: "planning",
      modifyPlan: null,
      createdAt: now,
      lastActiveAt: now,
      sender,
    };
    this.sessions.set(sessionId, session);

    // Fire-and-forget: 流式规划在后台进行，IPC handler 可立即返回 sessionId
    this._runModifyPlanStream(sessionId, session).catch((err) => {
      session.status = "failed";
      if (sender && !sender.isDestroyed()) {
        sender.send(`modification:error:${sessionId}`, {
          code: err instanceof GeneratorError ? err.code : "MODIFY_PLAN_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { sessionId };
  }

  /**
   * 获取指定会话的 ModifyPlan（仅 awaiting_confirmation 状态下有效）。
   *
   * @param sessionId 修改会话 ID
   * @returns ModifyPlan 或 null（规划尚未完成时）
   */
  getModifySession(sessionId: string): ModifyPlan | null {
    const session = this.getValidSession(sessionId);
    session.lastActiveAt = Date.now();
    return session.modifyPlan;
  }

  /**
   * 获取会话关联的 appId（供 confirm 处理器使用，无需客户端重复传递）。
   */
  getSessionAppId(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    return session?.appId ?? null;
  }

  /**
   * 取消增量修改会话，调用 M-04 cancelSession()。
   *
   * @param sessionId 修改会话 ID
   */
  cancelModifySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.aiProvider.cancelSession(sessionId).catch(() => {
      // 取消失败时静默忽略，会话将在超时后被清理
    });
    this.sessions.delete(sessionId);
  }

  /**
   * 释放资源，停止超时清理定时器。
   * 在主进程关闭时调用。
   */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 内部流式增量规划执行器，以 fire-and-forget 方式调用。
   */
  private async _runModifyPlanStream(
    sessionId: string,
    session: ModifySessionState,
  ): Promise<void> {
    const { appDir, requirement, sender } = session;

    // 1. 扫描现有代码结构
    const existingFiles = await scanAppSourceFiles(appDir);

    // 2. 构造传给 AI 的上下文消息
    const contextMessage = buildModifyContextMessage(existingFiles, requirement);

    // 3. 调用 M-04 planApp()（增量规划）
    const stream = this.aiProvider.planApp({
      sessionId,
      intent: requirement,
      skills: [],
      contextHistory: [
        { role: "user", content: contextMessage },
      ],
    });

    // 4. 消费流：转发 PlanChunk 给渲染进程，收集 assistant 内容
    let planResult: import("@intentos/shared-types").PlanResult | null = null;

    for await (const chunk of stream) {
      if (sender && !sender.isDestroyed()) {
        sender.send(`modification:plan-chunk:${sessionId}`, chunk);
      }

      if (chunk.phase === "complete" && chunk.planResult) {
        planResult = chunk.planResult;
      }
    }

    // 5. 将 PlanResult 解析为 ModifyPlan（added/modified/unchanged）
    if (!planResult) {
      throw new GeneratorError("MODIFY_SESSION_WRONG_STATE", {
        sessionId,
        reason: "AI did not return a planResult in the complete chunk",
      });
    }

    const existingPaths = new Set(existingFiles.map((f) => f.path));
    const modifyPlan = buildModifyPlan(sessionId, planResult, existingPaths);

    session.modifyPlan = modifyPlan;
    session.status = "awaiting_confirmation";
    session.lastActiveAt = Date.now();

    // 6. 通知渲染进程规划完成
    if (sender && !sender.isDestroyed()) {
      sender.send(`modification:plan-complete:${sessionId}`, modifyPlan);
    }
  }

  /**
   * 获取并验证 session，区分"不存在"和"已超时"两种情况。
   */
  private getValidSession(sessionId: string): ModifySessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new GeneratorError("MODIFY_SESSION_NOT_FOUND", { sessionId });
    }

    if (Date.now() - session.lastActiveAt > SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionId);
      this.aiProvider.cancelSession(sessionId).catch(() => {});
      throw new GeneratorError("MODIFY_SESSION_EXPIRED", { sessionId });
    }

    return session;
  }

  /**
   * 启动会话超时清理定时器。
   * 每 5 分钟扫描一次，将超过 30 分钟未活动的会话取消并删除。
   */
  private startCleanupTimer(): NodeJS.Timeout {
    return setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) {
          this.aiProvider.cancelSession(sessionId).catch(() => {});
          this.sessions.delete(sessionId);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 扫描 SkillApp 的 src/app/ 目录，返回所有源文件的路径和首行摘要。
 *
 * @param appDir SkillApp 根目录（绝对路径）
 * @returns 相对路径列表及各文件首行内容
 */
async function scanAppSourceFiles(appDir: string): Promise<ExistingFile[]> {
  const srcDir = path.join(appDir, "src", "app");

  // 若 src/app/ 不存在，返回空列表（新 App 或目录结构特殊）
  try {
    await fs.promises.access(srcDir);
  } catch {
    return [];
  }

  const results: ExistingFile[] = [];
  await scanDirRecursive(appDir, srcDir, results);
  return results;
}

/**
 * 递归扫描目录，将源文件加入结果列表。
 *
 * @param appDir  SkillApp 根目录（用于计算相对路径）
 * @param currentDir 当前扫描目录
 * @param results 结果累积数组
 */
async function scanDirRecursive(
  appDir: string,
  currentDir: string,
  results: ExistingFile[],
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // 跳过 node_modules 和隐藏目录
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      await scanDirRecursive(appDir, fullPath, results);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      const relativePath = path.relative(appDir, fullPath).replace(/\\/g, "/");
      const firstLines = await readFirstLines(fullPath, FILE_SUMMARY_LINES);
      results.push({ path: relativePath, firstLines });
    }
  }
}

/**
 * 判断是否为感兴趣的源文件（TypeScript / JavaScript / JSON / CSS）。
 */
function isSourceFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".json", ".css"].includes(ext);
}

/**
 * 读取文件的首 N 行内容。
 *
 * @param filePath 文件绝对路径
 * @param lineCount 最多读取的行数
 * @returns 首行内容字符串（多行以 \n 连接）
 */
async function readFirstLines(filePath: string, lineCount: number): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split("\n").slice(0, lineCount);
    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * 构造传给 AI 的上下文消息，描述现有代码结构和修改需求。
 *
 * @param existingFiles 现有文件列表及摘要
 * @param requirement   用户的修改需求
 * @returns 格式化的上下文字符串
 */
function buildModifyContextMessage(
  existingFiles: ExistingFile[],
  requirement: string,
): string {
  const fileList = existingFiles.length > 0
    ? existingFiles
        .map((f) => `### ${f.path}\n\`\`\`\n${f.firstLines}\n\`\`\``)
        .join("\n\n")
    : "（暂无源文件）";

  return `# 现有 SkillApp 代码结构

以下是当前 SkillApp 的源文件列表和各文件的首行内容摘要：

${fileList}

---

# 用户修改需求

${requirement}

---

# 任务说明

请基于上述现有代码结构和用户需求，生成一份增量修改方案。
方案中需明确：
1. **新增（added）**：需要新建的文件（不存在于上述列表中）
2. **修改（modified）**：需要修改的文件（已存在于上述列表中）
3. **不变（unchanged）**：无需改动的文件（已存在于上述列表中，且不受本次修改影响）

请以 PlanResult 格式输出方案，其中 modules 字段只包含 added 和 modified 的文件。`;
}

/**
 * 将 AI 返回的 PlanResult 转换为 ModifyPlan。
 *
 * 规则：
 * - PlanResult.modules 中的文件路径若在 existingPaths 中存在 → modified
 * - PlanResult.modules 中的文件路径若不在 existingPaths 中 → added
 * - existingPaths 中有但不在 PlanResult.modules 中的路径 → unchanged
 *
 * @param sessionId    修改会话 ID
 * @param planResult   AI 返回的规划结果
 * @param existingPaths 现有文件的相对路径集合
 * @returns 分类好的 ModifyPlan
 */
function buildModifyPlan(
  sessionId: string,
  planResult: import("@intentos/shared-types").PlanResult,
  existingPaths: Set<string>,
): ModifyPlan {
  const added: ModuleChange[] = [];
  const modified: ModuleChange[] = [];
  const affectedPaths = new Set<string>();

  for (const module of planResult.modules) {
    affectedPaths.add(module.filePath);

    if (existingPaths.has(module.filePath)) {
      modified.push({
        filePath: module.filePath,
        description: module.description,
      });
    } else {
      added.push({
        filePath: module.filePath,
        description: module.description,
      });
    }
  }

  // unchanged = 现有文件中未被 AI 规划涉及的文件
  const unchanged: string[] = [];
  for (const existingPath of existingPaths) {
    if (!affectedPaths.has(existingPath)) {
      unchanged.push(existingPath);
    }
  }
  unchanged.sort(); // 排序保证输出稳定

  return { sessionId, added, modified, unchanged };
}

// ── 单例导出 ──────────────────────────────────────────────────────────────────

/**
 * ModifySessionManager 工厂函数。
 *
 * 通过 `createModifySessionManager()` 创建单例，依赖项在应用启动时注入。
 * 若需在整个主进程中共享同一实例，在 M-01 初始化时调用此函数并保存引用。
 */
export function createModifySessionManager(
  aiProvider: AIProvider,
  getAppDir: (appId: string) => Promise<string>,
): ModifySessionManager {
  return new ModifySessionManager(aiProvider, getAppDir);
}
