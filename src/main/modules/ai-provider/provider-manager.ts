/**
 * M-04 AI Provider — AIProviderManager
 *
 * Manages the single active AIProvider instance, wraps its streaming methods
 * with queue-based concurrency control, and broadcasts status changes to all
 * registered listeners via Node.js EventEmitter.
 */

import { EventEmitter } from "events";

import type { ProviderStatus, ProviderConfig, PlanChunk, GenProgressChunk } from "./interfaces";
import type { AIProvider, PlanRequest, GenerateRequest, SkillCallRequest, SkillCallResult, StreamTextRequest, StreamTextChunk } from "./interfaces";
import { RequestQueueManager } from "./request-queue";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLAN_GEN_CONCURRENCY = 1;
const SKILL_CONCURRENCY = 5;
const STATUS_CHANGED_EVENT = "statusChanged";

// ── AIProviderManager ─────────────────────────────────────────────────────────

export class AIProviderManager {
  private activeProvider: AIProvider | null = null;
  private readonly planQueue: RequestQueueManager;
  private readonly skillQueue: RequestQueueManager;
  private readonly emitter: EventEmitter;

  constructor() {
    this.planQueue = new RequestQueueManager(PLAN_GEN_CONCURRENCY);
    this.skillQueue = new RequestQueueManager(SKILL_CONCURRENCY);
    this.emitter = new EventEmitter();
  }

  // ── Provider lifecycle ─────────────────────────────────────────────────────

  /**
   * Set (and initialise) a new provider.  If a provider is already active it
   * is disposed first.
   */
  async setProvider(provider: AIProvider, config: ProviderConfig): Promise<void> {
    if (this.activeProvider !== null) {
      await this._disposeActiveProvider();
    }

    // Wire up the status-change callback before initialising so we capture the
    // "initializing" → "ready" / "error" transitions.
    provider.onStatusChanged = (status: ProviderStatus) => {
      this._emitStatusChanged(status);
    };

    this.activeProvider = provider;
    await provider.initialize(config);
  }

  /** Returns the current active provider, or null if none is set. */
  getProvider(): AIProvider | null {
    return this.activeProvider;
  }

  /** Returns the current provider's status, or "uninitialized" if none is set. */
  getProviderStatus(): ProviderStatus {
    return this.activeProvider?.status ?? "uninitialized";
  }

  /**
   * Register a listener that is called whenever the provider status changes.
   * Returns an unsubscribe function.
   */
  onStatusChanged(callback: (status: ProviderStatus) => void): () => void {
    this.emitter.on(STATUS_CHANGED_EVENT, callback);
    return () => {
      this.emitter.off(STATUS_CHANGED_EVENT, callback);
    };
  }

  // ── Wrapped provider methods ───────────────────────────────────────────────

  /**
   * planApp — queued with plan/generate concurrency limit (max 1).
   * Yields PlanChunk items from the underlying provider.
   */
  async *planApp(request: PlanRequest): AsyncIterable<PlanChunk> {
    const provider = this._requireProvider();
    await this.planQueue.enqueue(request.sessionId);
    try {
      yield* provider.planApp(request);
    } finally {
      this.planQueue.complete(request.sessionId);
    }
  }

  /**
   * generateCode — queued with plan/generate concurrency limit (max 1).
   * Yields GenProgressChunk items from the underlying provider.
   */
  async *generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk> {
    const provider = this._requireProvider();
    await this.planQueue.enqueue(request.sessionId);
    try {
      yield* provider.generateCode(request);
    } finally {
      this.planQueue.complete(request.sessionId);
    }
  }

  /**
   * executeSkill — queued with skill concurrency limit (max 5).
   */
  async executeSkill(request: SkillCallRequest): Promise<SkillCallResult> {
    const provider = this._requireProvider();
    await this.skillQueue.enqueue(request.sessionId);
    try {
      return await provider.executeSkill(request);
    } finally {
      this.skillQueue.complete(request.sessionId);
    }
  }

  /**
   * streamText — generic streaming text generation with a custom system prompt.
   * Queued with plan/generate concurrency limit (max 1).
   */
  async *streamText(request: StreamTextRequest): AsyncIterable<StreamTextChunk> {
    const provider = this._requireProvider();
    await this.planQueue.enqueue(request.sessionId);
    try {
      yield* provider.streamText(request);
    } finally {
      this.planQueue.complete(request.sessionId);
    }
  }

  /**
   * cancelSession — cancels the session in both queues and delegates to the
   * underlying provider (which aborts the AbortController for the active
   * streaming call).
   */
  async cancelSession(sessionId: string): Promise<void> {
    this.planQueue.cancel(sessionId);
    this.skillQueue.cancel(sessionId);
    if (this.activeProvider !== null) {
      await this.activeProvider.cancelSession(sessionId);
    }
  }

  /**
   * dispose — dispose the active provider and clear internal state.
   */
  async dispose(): Promise<void> {
    await this._disposeActiveProvider();
    this.emitter.removeAllListeners();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _requireProvider(): AIProvider {
    if (this.activeProvider === null) {
      throw new Error("No AIProvider is set. Call setProvider() first.");
    }
    return this.activeProvider;
  }

  private async _disposeActiveProvider(): Promise<void> {
    if (this.activeProvider === null) {
      return;
    }
    const provider = this.activeProvider;
    // Detach status callback before disposal so we don't emit spurious events
    // after the manager has been torn down.
    provider.onStatusChanged = undefined;
    this.activeProvider = null;
    await provider.dispose();
  }

  private _emitStatusChanged(status: ProviderStatus): void {
    this.emitter.emit(STATUS_CHANGED_EVENT, status);
  }
}
