/**
 * M-04 AI Provider — interfaces and M-04-specific request/result types
 *
 * Shared streaming types (PlanChunk, GenProgressChunk, etc.) are imported from
 * @intentos/shared-types.  Only types that are internal to the AI-provider
 * module (request shapes, skill call contracts) are defined here.
 */

import type {
  ProviderStatus,
  ProviderConfig,
  ClaudeProviderConfig,
  CustomProviderConfig,
  OpenClawProviderConfig,
  PlanChunk,
  GenProgressChunk,
  PlanResult,
  SkillMeta,
} from "@intentos/shared-types";

// Re-export shared types consumed by callers of this module so they only need
// one import path.
export type {
  ProviderStatus,
  ProviderConfig,
  ClaudeProviderConfig,
  CustomProviderConfig,
  OpenClawProviderConfig,
  PlanChunk,
  GenProgressChunk,
  PlanResult,
  SkillMeta,
};

// ── M-04-specific request types ───────────────────────────────────────────────

export interface PlanRequest {
  sessionId: string;
  intent: string;
  skills: SkillMeta[];
  contextHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface GenerateRequest {
  sessionId: string;
  plan: PlanResult;
  appId: string;
  targetDir: string;
}

export interface StreamTextRequest {
  sessionId: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface StreamTextChunk {
  sessionId: string;
  content: string;
  done: boolean;
}

export interface SkillCallRequest {
  sessionId: string;
  skillId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SkillCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}

// ── AIProvider interface ───────────────────────────────────────────────────────

/**
 * AIProvider abstraction interface.
 * All AI backends (Claude API, OpenClaw, …) must implement this interface.
 * Defined to be fully consistent with ai-provider-spec.md §1.2.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly status: ProviderStatus;

  /** Initialise the provider (connect, validate credentials, etc.) */
  initialize(config: ProviderConfig): Promise<void>;

  /** Release resources and disconnect */
  dispose(): Promise<void>;

  /**
   * Intent planning: natural-language intent + available Skills → SkillApp design.
   * @returns AsyncIterable streaming plan chunks (thinking → drafting → complete)
   */
  planApp(request: PlanRequest): AsyncIterable<PlanChunk>;

  /**
   * Code generation: planning result → generated SkillApp source + build.
   * @returns AsyncIterable streaming progress chunks (codegen → compile → bundle → done)
   */
  generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk>;

  /**
   * Skill execution: triggered by SkillApp via M-06, calls a specific Skill method.
   * @returns Promise (non-streaming; waits for the full execution result)
   */
  executeSkill(request: SkillCallRequest): Promise<SkillCallResult>;

  /**
   * Generic streaming text generation with a custom system prompt.
   * Used by MockPreviewGenerator to generate HTML without the planning system prompt.
   */
  streamText(request: StreamTextRequest): AsyncIterable<StreamTextChunk>;

  /** Cancel an in-progress session */
  cancelSession(sessionId: string): Promise<void>;

  /** Callback invoked when the provider status changes */
  onStatusChanged?: ((status: ProviderStatus) => void) | undefined;
}
