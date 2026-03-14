/**
 * M-04 AI Provider — RequestQueueManager
 *
 * Manages concurrent request limits and FIFO queuing for plan/generate and
 * skill-call request types.  Each active session gets its own AbortController
 * so individual sessions can be cancelled independently.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingRequest {
  sessionId: string;
  /** Resolve callback stored so the caller can await enqueue() */
  resolve: () => void;
  /** Reject callback used when the request is cancelled before it starts */
  reject: (reason: Error) => void;
}

interface ActiveRequest {
  sessionId: string;
  controller: AbortController;
}

// ── RequestQueueManager ────────────────────────────────────────────────────────

const MAX_QUEUE_LENGTH = 10;

export class RequestQueueManager {
  readonly maxConcurrent: number;

  private readonly activeRequests: Map<string, ActiveRequest> = new Map();
  private readonly pendingQueue: PendingRequest[] = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Enqueue a new request.  Resolves immediately when the session is admitted
   * into the active set, or rejects with an error if:
   *   - the pending queue is already at capacity (10 items), or
   *   - the session is cancelled before it is dequeued.
   */
  enqueue(sessionId: string): Promise<void> {
    // If there is capacity right now, admit immediately.
    if (this.activeRequests.size < this.maxConcurrent) {
      this._admit(sessionId);
      return Promise.resolve();
    }

    // Enforce queue capacity limit.
    if (this.pendingQueue.length >= MAX_QUEUE_LENGTH) {
      return Promise.reject(
        new Error(
          `Request queue is full (max ${MAX_QUEUE_LENGTH} pending). ` +
            `Session "${sessionId}" was rejected.`
        )
      );
    }

    // Park the caller in the pending queue.
    return new Promise<void>((resolve, reject) => {
      this.pendingQueue.push({ sessionId, resolve, reject });
    });
  }

  /**
   * Dequeue the next pending request and admit it.
   * Called internally after an active request completes or is cancelled.
   */
  dequeue(): PendingRequest | null {
    const next = this.pendingQueue.shift();
    if (next === undefined) {
      return null;
    }
    this._admit(next.sessionId);
    next.resolve();
    return next;
  }

  /**
   * Mark a session as complete and admit the next pending request (if any).
   */
  complete(sessionId: string): void {
    this.activeRequests.delete(sessionId);
    this.dequeue();
  }

  /**
   * Cancel a session.
   *
   * - If the session is active, its AbortController is aborted and it is
   *   removed from the active set (triggering admission of the next pending
   *   request).
   * - If the session is still pending in the queue, it is removed and its
   *   promise is rejected with a cancellation error.
   */
  cancel(sessionId: string): void {
    // Cancel an active session.
    const active = this.activeRequests.get(sessionId);
    if (active !== undefined) {
      active.controller.abort();
      this.activeRequests.delete(sessionId);
      this.dequeue();
      return;
    }

    // Remove from the pending queue and reject its promise.
    const idx = this.pendingQueue.findIndex((r) => r.sessionId === sessionId);
    if (idx !== -1) {
      const [pending] = this.pendingQueue.splice(idx, 1);
      pending.reject(
        new Error(`Session "${sessionId}" was cancelled before it could start.`)
      );
    }
  }

  /**
   * Returns the AbortController for an active session, or undefined if the
   * session is not currently active.
   */
  getController(sessionId: string): AbortController | undefined {
    return this.activeRequests.get(sessionId)?.controller;
  }

  /** Number of currently active (running) sessions. */
  get activeCount(): number {
    return this.activeRequests.size;
  }

  /** Number of sessions waiting in the queue. */
  get pendingCount(): number {
    return this.pendingQueue.length;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _admit(sessionId: string): void {
    this.activeRequests.set(sessionId, {
      sessionId,
      controller: new AbortController(),
    });
  }
}
