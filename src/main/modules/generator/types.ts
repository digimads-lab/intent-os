/**
 * M-05 SkillApp 生成器 — 内部类型定义
 *
 * 本文件定义 generator 模块内部使用的会话状态类型、请求/结果类型，
 * 以及供外部消费者使用的公开数据结构。
 * 共享流式类型（PlanChunk、PlanResult 等）从 @intentos/shared-types 重新导出。
 */

import type { PlanResult, PlanModule, SkillUsage } from "@intentos/shared-types";

// ── 共享类型重新导出 ──────────────────────────────────────────────────────────

export type { PlanResult, PlanModule };

/**
 * Skill 使用映射条目（对应 @intentos/shared-types 中的 SkillUsage）
 * 重新导出并附加别名，保持 M-05 内部命名一致。
 */
export type SkillUsageItem = SkillUsage;

// ── 公开请求类型 ───────────────────────────────────────────────────────────────

/**
 * 启动规划会话的请求参数
 */
export interface StartPlanRequest {
  /** 用户选择的 Skill ID 列表（至少 1 个） */
  skillIds: string[];

  /** 用户输入的自然语言意图描述 */
  intent: string;
}

// ── 内部会话状态类型（不对外暴露） ───────────────────────────────────────────

/**
 * 对话历史条目，记录规划会话中每一轮的用户/助手消息
 */
export interface ContextHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * PlanSession 内部状态，存储在 PlanSessionManager.sessions Map 中
 */
export interface PlanSessionState {
  sessionId: string;
  status: "idle" | "planning" | "awaiting_feedback" | "complete" | "failed";
  request: StartPlanRequest;
  contextHistory: ContextHistoryEntry[];
  lastPlanResult: PlanResult | null;
  createdAt: number;
  lastActiveAt: number;
  /** The renderer WebContents that initiated this session — used for per-session IPC routing */
  sender: import("electron").WebContents | null;
}

// ── 编译相关类型 ───────────────────────────────────────────────────────────────

/**
 * TypeScript 编译错误的结构化表示
 */
export interface CompileError {
  /** 出错文件的相对路径，如 'src/app/pages/ImportPage.tsx' */
  file: string;

  /** 出错行号（1-based） */
  line: number;

  /** 出错列号（1-based） */
  column: number;

  /** TypeScript 错误消息 */
  message: string;

  /** TypeScript 错误码，如 'TS2345' */
  code: string;
}

/**
 * CompileFixer.tryFix() 的返回结果
 */
export interface CompileFixResult {
  /** 是否修复成功（最终编译通过） */
  success: boolean;

  /** 实际尝试次数（1-3） */
  attempts: number;

  /** 修复失败时，最后一次编译的错误列表 */
  finalErrors?: CompileError[];
}

// ── 增量修改类型 ───────────────────────────────────────────────────────────────

/**
 * 单个模块的变更描述（用于增量修改方案）
 */
export interface ModuleChange {
  /** 文件相对路径，如 'src/app/pages/SchedulePage.tsx' */
  filePath: string;

  /**
   * 变更描述（展示给用户）
   * 如 "新增调度配置页面，支持设置定时任务参数"
   */
  description: string;

  /**
   * 文件新内容（confirmAndApplyModify 执行时填充）
   * startModifySession 返回时此字段为 undefined
   */
  content?: string;
}

/**
 * AI 生成的增量修改方案
 */
export interface ModifyPlan {
  /** 修改会话 ID */
  sessionId: string;

  /** 新增的模块列表 */
  added: ModuleChange[];

  /** 需修改的模块列表 */
  modified: ModuleChange[];

  /**
   * 不变的文件路径列表（相对于 appDir）
   * 展示给用户，明确哪些部分不受影响
   */
  unchanged: string[];
}

// ── 错误类型 ───────────────────────────────────────────────────────────────────

/**
 * M-05 生成器模块错误码
 */
export type GeneratorErrorCode =
  | "PLAN_SESSION_NOT_FOUND" // 规划会话不存在（sessionId 无效）
  | "PLAN_SESSION_EXPIRED" // 规划会话已超时清理
  | "PLAN_SESSION_WRONG_STATE" // 会话状态不允许当前操作（如在 planning 状态下调用 getPlanResult）
  | "GENERATION_FAILED" // 代码生成过程中发生不可恢复的错误
  | "COMPILE_MAX_RETRIES_EXCEEDED" // 编译修复达到最大重试次数（context 中含 finalErrors: CompileError[]）
  | "MODIFY_SESSION_NOT_FOUND" // 增量修改会话不存在
  | "MODIFY_SESSION_EXPIRED" // 增量修改会话已超时清理
  | "MODIFY_SESSION_WRONG_STATE" // 修改会话状态不允许当前操作
  | "APP_DIR_NOT_FOUND" // 目标 SkillApp 目录不存在（修改时）
  | "PLAN_RESULT_MISSING"; // 尝试 confirmAndGenerate 时规划结果为 null

/**
 * M-05 生成器模块统一错误类
 *
 * 所有从 generator 模块抛出的错误都使用此类封装，
 * 调用方可通过 `error.code` 字段匹配具体错误类型并给出对应提示。
 */
export class GeneratorError extends Error {
  constructor(
    public readonly code: GeneratorErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(`[M-05] ${code}`);
    this.name = "GeneratorError";
  }
}
