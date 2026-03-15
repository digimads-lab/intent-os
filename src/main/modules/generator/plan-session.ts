/**
 * M-05 SkillApp 生成器 — 规划会话管理器
 *
 * 职责：
 * - 创建和管理规划会话（PlanSession）
 * - 维护每个会话的多轮对话历史（contextHistory）
 * - 调用 M-04 planApp()，将流式 PlanChunk 通过 IPC 转发给渲染进程
 * - 在用户每次 refinePlan() 时将新一轮对话追加到历史，确保 Claude API 收到完整对话上下文
 */

import { randomUUID } from "crypto";

import type { WebContents } from "electron";

import type { PlanResult, SkillMeta } from "@intentos/shared-types";
import type { PlanRequest } from "../ai-provider/interfaces";
import type { PlanChunk } from "@intentos/shared-types";

/** Narrow interface: anything that can plan and cancel — AIProvider or AIProviderManager both satisfy this. */
interface PlanCapable {
  planApp(request: PlanRequest): AsyncIterable<PlanChunk>
  cancelSession(sessionId: string): Promise<void>
}
import type { SkillManager } from "../skill-manager/skill-manager";
import type {
  StartPlanRequest,
  PlanSessionState,
  ContextHistoryEntry,
} from "./types";
import { GeneratorError } from "./types";

// ── 常量 ───────────────────────────────────────────────────────────────────────

/** 会话超时时长：30 分钟无操作后自动清理 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** 超时扫描间隔：每 5 分钟扫描一次 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ── PlanSessionManager ────────────────────────────────────────────────────────

/**
 * 规划会话管理器
 *
 * 管理用户从输入意图到确认规划方案的多轮交互流程。
 * 每个会话维护独立的对话历史，确保每次调用 M-04 planApp() 时
 * 都能传入完整的历史上下文。
 */
export class PlanSessionManager {
  private readonly sessions: Map<string, PlanSessionState> = new Map();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly aiProvider: PlanCapable,
    private readonly skillManager: SkillManager,
    private readonly getWindowSender: () => WebContents | null,
  ) {
    this.cleanupTimer = this.startCleanupTimer();
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /**
   * 启动规划会话，调用 M-04 planApp()，流式返回规划方案。
   * 同时通过 IPC 将 PlanChunk 转发给渲染进程。
   *
   * @param request 包含 skillIds 和 intent 的规划请求
   * @returns 会话 ID，渲染进程用于订阅后续 IPC 事件
   */
  /**
   * 启动规划会话（即时返回 sessionId，流式输出在后台异步进行）。
   *
   * 推荐在 IPC handler 中使用此方法：handler 立即返回 sessionId，
   * 渲染进程随即订阅 plan-chunk:{sessionId} 事件，随后背景流开始推送 chunk。
   *
   * @param sessionId 由 IPC handler 预先生成的 UUID（保证渲染进程与主进程使用同一 ID）
   * @param request 规划请求（skillIds + intent）
   * @param sender 发起请求的渲染进程 WebContents（用于精确 IPC 路由，不广播）
   */
  beginPlanSession(
    sessionId: string,
    request: StartPlanRequest,
    sender: WebContents | null,
  ): void {
    const now = Date.now();
    const session: PlanSessionState = {
      sessionId,
      status: "planning",
      request,
      contextHistory: [],
      lastPlanResult: null,
      createdAt: now,
      lastActiveAt: now,
      sender,
    };
    this.sessions.set(sessionId, session);

    // Fire-and-forget: streaming happens after IPC handler returns sessionId to renderer
    this._runPlanStream(sessionId, session, request.intent, []).catch((err) => {
      session.status = "failed";
      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:plan-error:${sessionId}`, {
          code: "STREAM_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async startPlanSession(
    request: StartPlanRequest,
  ): Promise<{ sessionId: string }> {
    const sessionId = randomUUID();
    const now = Date.now();

    const session: PlanSessionState = {
      sessionId,
      status: "planning",
      request,
      contextHistory: [],
      lastPlanResult: null,
      createdAt: now,
      lastActiveAt: now,
      sender: this.getWindowSender(),
    };
    this.sessions.set(sessionId, session);

    try {
      const skills = await this.resolveSkills(request.skillIds);

      // 第一轮：contextHistory 为空，intent 通过独立字段传入
      const stream = this.aiProvider.planApp({
        sessionId,
        intent: request.intent,
        skills,
        contextHistory: [],
      });

      const assistantContent = await this.consumePlanStream(
        sessionId,
        session,
        stream,
        session.sender,
      );

      // 将第一轮的用户意图和助手回复记入历史，供后续 refinePlan 使用
      session.contextHistory.push({ role: "user", content: request.intent });
      session.contextHistory.push({
        role: "assistant",
        content: assistantContent,
      });

      session.status = "awaiting_feedback";
      session.lastActiveAt = Date.now();

      const sender = session.sender;
      if (sender && !sender.isDestroyed()) {
        sender.send(
          `ai-provider:plan-complete:${sessionId}`,
          session.lastPlanResult,
        );
      }
    } catch (error) {
      session.status = "failed";
      throw error;
    }

    return { sessionId };
  }

  /**
   * 在规划会话中追加用户反馈，调用 M-04 planApp() 继续规划。
   * 必须将完整的 contextHistory（含本轮之前所有对话）传入 M-04。
   *
   * @param sessionId 规划会话 ID
   * @param feedback 用户对当前方案的修改意见
   */
  async refinePlan(sessionId: string, feedback: string): Promise<void> {
    const session = this.getValidSession(sessionId);

    if (session.status !== "awaiting_feedback") {
      throw new GeneratorError("PLAN_SESSION_WRONG_STATE", {
        sessionId,
        currentStatus: session.status,
        requiredStatus: "awaiting_feedback",
      });
    }

    session.status = "planning";
    session.lastActiveAt = Date.now();

    // Fire-and-forget: stream runs in background so handler can return immediately
    this._runPlanStream(sessionId, session, feedback, session.contextHistory).catch((err) => {
      session.status = "failed";
      const sender = session.sender;
      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:plan-error:${sessionId}`, {
          code: "REFINE_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /**
   * 获取当前会话的规划结果（仅 awaiting_feedback 状态下可用）。
   *
   * @param sessionId 规划会话 ID
   * @returns 最近一次规划方案，若尚未完成则返回 null
   */
  async getPlanResult(sessionId: string): Promise<PlanResult | null> {
    const session = this.getValidSession(sessionId);

    if (session.status !== "awaiting_feedback") {
      throw new GeneratorError("PLAN_SESSION_WRONG_STATE", {
        sessionId,
        currentStatus: session.status,
        requiredStatus: "awaiting_feedback",
      });
    }

    session.lastActiveAt = Date.now();
    return session.lastPlanResult;
  }

  /**
   * 取消规划会话，调用 M-04 cancelSession()。
   *
   * @param sessionId 规划会话 ID
   */
  cancelPlanSession(sessionId: string): void {
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
   * 获取并验证 session，若不存在则区分"不存在"与"已超时"两种情况。
   * 注意：超时的 session 已被清理器从 Map 中删除，因此此处统一以
   * PLAN_SESSION_NOT_FOUND 处理。调用方若需区分两者，应在超时清理前
   * 将状态标记为 'expired'；当前版本按规范简化处理。
   */
  private getValidSession(sessionId: string): PlanSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      // 若会话已被超时清理器删除，抛出 EXPIRED；
      // 若从未创建，抛出 NOT_FOUND。
      // 因清理后无法区分，统一使用 EXPIRED（超时更常见）。
      // 注：如需精确区分，可维护一个已超时 sessionId 集合。
      throw new GeneratorError("PLAN_SESSION_NOT_FOUND", { sessionId });
    }

    // 检查是否已超时（session 仍在 Map 中但超过 30 分钟未活动）
    if (Date.now() - session.lastActiveAt > SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionId);
      this.aiProvider.cancelSession(sessionId).catch(() => {});
      throw new GeneratorError("PLAN_SESSION_EXPIRED", { sessionId });
    }

    return session;
  }

  /**
   * 内部流式规划执行器，供 beginPlanSession 和 refinePlan 以 fire-and-forget 方式调用。
   * 使用 session.sender 进行精确 IPC 路由（不广播给所有窗口）。
   *
   * @param sessionId  会话 ID
   * @param session    会话状态对象
   * @param intent     本轮意图/反馈文本
   * @param contextHistory 本轮调用前的历史（不含本轮 intent）
   */
  private async _runPlanStream(
    sessionId: string,
    session: PlanSessionState,
    intent: string,
    contextHistory: ContextHistoryEntry[],
  ): Promise<void> {
    const skills = await this.resolveSkills(session.request.skillIds);
    const stream = this.aiProvider.planApp({
      sessionId,
      intent,
      skills,
      contextHistory: [...contextHistory],
    });

    const assistantContent = await this.consumePlanStream(sessionId, session, stream, session.sender);

    session.contextHistory.push({ role: "user", content: intent });
    session.contextHistory.push({ role: "assistant", content: assistantContent });
    session.status = "awaiting_feedback";
    session.lastActiveAt = Date.now();

    const sender = session.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send(`ai-provider:plan-complete:${sessionId}`, session.lastPlanResult);
    }
  }

  /**
   * 消费 planApp() 返回的 AsyncIterable<PlanChunk>，
   * 将每个 chunk 转发给渲染进程，并在 phase==='complete' 时存储规划结果。
   *
   * @returns 累积的 assistant 回复文本（用于记录到 contextHistory）
   */
  private async consumePlanStream(
    sessionId: string,
    session: PlanSessionState,
    stream: AsyncIterable<import("@intentos/shared-types").PlanChunk>,
    sender: WebContents | null,
  ): Promise<string> {
    let assistantContent = "";

    for await (const chunk of stream) {
      assistantContent += chunk.content;

      if (sender && !sender.isDestroyed()) {
        sender.send(`ai-provider:plan-chunk:${sessionId}`, chunk);
      }

      if (chunk.phase === "complete" && chunk.planResult) {
        session.lastPlanResult = chunk.planResult;
      }
    }

    return assistantContent;
  }

  /**
   * 根据 skillIds 从 SkillManager 获取对应的 SkillMeta 列表。
   * SkillManager 提供 getSkillById()，此处批量查询并过滤有效结果。
   */
  private async resolveSkills(skillIds: string[]): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];
    for (const id of skillIds) {
      const registration = this.skillManager.getSkillById(id);
      if (registration) {
        // SkillRegistration 是 SkillMeta 的超集，直接转型
        const meta: SkillMeta = {
          id: registration.id,
          name: registration.name,
          version: registration.version,
          description: registration.description,
          author: registration.author,
          capabilities: registration.capabilities,
          dependencies: registration.dependencies,
          entryPoint: registration.entryPoint,
          manifestPath: registration.manifestPath,
        };
        skills.push(meta);
      }
    }
    return skills;
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
