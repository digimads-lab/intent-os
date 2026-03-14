/**
 * Unit tests for RequestQueueManager
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { RequestQueueManager } from '../request-queue'

describe('RequestQueueManager', () => {
  let queue: RequestQueueManager

  beforeEach(() => {
    queue = new RequestQueueManager(2)
  })

  // ── enqueue: immediate admission ─────────────────────────────────────────────

  it('resolves immediately when concurrency slot is available', async () => {
    const p = queue.enqueue('session-1')
    await expect(p).resolves.toBeUndefined()
    expect(queue.activeCount).toBe(1)
  })

  it('admits multiple sessions up to the concurrency limit without queuing', async () => {
    await queue.enqueue('session-1')
    await queue.enqueue('session-2')
    expect(queue.activeCount).toBe(2)
    expect(queue.pendingCount).toBe(0)
  })

  // ── enqueue: queuing when full ────────────────────────────────────────────────

  it('does not resolve immediately when all concurrency slots are occupied', async () => {
    await queue.enqueue('session-1')
    await queue.enqueue('session-2')

    let resolved = false
    const p = queue.enqueue('session-3')
    p.then(() => { resolved = true })

    // Yield to microtask queue — promise must still be pending
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(queue.pendingCount).toBe(1)

    // Clean up
    queue.complete('session-1')
    await p
  })

  it('adds waiting session to the pending queue', async () => {
    await queue.enqueue('session-1')
    await queue.enqueue('session-2')

    const p = queue.enqueue('session-3')
    expect(queue.pendingCount).toBe(1)

    queue.complete('session-1')
    await p
  })

  // ── enqueue: queue capacity limit ─────────────────────────────────────────────

  it('rejects when the pending queue exceeds 10 items', async () => {
    // Fill concurrency slots
    await queue.enqueue('active-1')
    await queue.enqueue('active-2')

    // Fill the pending queue to capacity (10)
    const pendingPromises: Promise<void>[] = []
    for (let i = 0; i < 10; i++) {
      pendingPromises.push(queue.enqueue(`pending-${i}`))
    }
    expect(queue.pendingCount).toBe(10)

    // The 11th enqueue must reject
    await expect(queue.enqueue('overflow')).rejects.toThrow('queue is full')

    // Cleanup to avoid unhandled rejections
    queue.cancel('active-1')
    queue.cancel('active-2')
    for (let i = 0; i < 10; i++) {
      queue.cancel(`pending-${i}`)
    }
    await Promise.allSettled(pendingPromises)
  })

  // ── complete: admits next pending request ─────────────────────────────────────

  it('admits the next pending request after complete() is called', async () => {
    await queue.enqueue('session-1')
    await queue.enqueue('session-2')

    let session3Resolved = false
    const p = queue.enqueue('session-3')
    p.then(() => { session3Resolved = true })

    // session-3 is still pending
    await Promise.resolve()
    expect(session3Resolved).toBe(false)

    // completing session-1 should admit session-3
    queue.complete('session-1')
    await p

    expect(session3Resolved).toBe(true)
    expect(queue.activeCount).toBe(2) // session-2 and session-3
    expect(queue.pendingCount).toBe(0)
  })

  it('decrements activeCount after complete()', async () => {
    await queue.enqueue('session-1')
    expect(queue.activeCount).toBe(1)

    queue.complete('session-1')
    expect(queue.activeCount).toBe(0)
  })

  // ── cancel: pending session ───────────────────────────────────────────────────

  it('rejects the queued promise when a pending session is cancelled', async () => {
    await queue.enqueue('active-1')
    await queue.enqueue('active-2')

    const p = queue.enqueue('pending-1')
    expect(queue.pendingCount).toBe(1)

    queue.cancel('pending-1')

    await expect(p).rejects.toThrow('cancelled before it could start')
    expect(queue.pendingCount).toBe(0)
  })

  it('removes the cancelled session from the pending queue', async () => {
    await queue.enqueue('active-1')
    await queue.enqueue('active-2')

    const p = queue.enqueue('pending-1')
    queue.cancel('pending-1')
    await p.catch(() => {/* expected */})

    expect(queue.pendingCount).toBe(0)
  })

  // ── cancel: active session ────────────────────────────────────────────────────

  it('aborts the AbortController of an active session when cancelled', () => {
    // Use a single-slot queue for simplicity
    const singleQueue = new RequestQueueManager(1)
    singleQueue.enqueue('active-1')

    const controller = singleQueue.getController('active-1')
    expect(controller).toBeDefined()
    expect(controller!.signal.aborted).toBe(false)

    singleQueue.cancel('active-1')

    expect(controller!.signal.aborted).toBe(true)
  })

  it('admits the next pending request after an active session is cancelled', async () => {
    const singleQueue = new RequestQueueManager(1)
    await singleQueue.enqueue('active-1')

    let pendingResolved = false
    const p = singleQueue.enqueue('pending-1')
    p.then(() => { pendingResolved = true })

    await Promise.resolve()
    expect(pendingResolved).toBe(false)

    singleQueue.cancel('active-1')
    await p

    expect(pendingResolved).toBe(true)
  })

  // ── getController ─────────────────────────────────────────────────────────────

  it('returns the AbortController for an active session', async () => {
    await queue.enqueue('session-1')
    const controller = queue.getController('session-1')
    expect(controller).toBeInstanceOf(AbortController)
  })

  it('returns undefined for a session that is not active', () => {
    expect(queue.getController('nonexistent')).toBeUndefined()
  })

  it('returns undefined for a session that is in the pending queue (not yet active)', async () => {
    await queue.enqueue('active-1')
    await queue.enqueue('active-2')

    const p = queue.enqueue('pending-1')
    expect(queue.getController('pending-1')).toBeUndefined()

    queue.complete('active-1')
    await p
  })
})
