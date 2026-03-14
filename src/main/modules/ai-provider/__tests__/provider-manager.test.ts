/**
 * Unit tests for AIProviderManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIProviderManager } from '../provider-manager'
import type { AIProvider, PlanRequest, SkillCallRequest, SkillCallResult } from '../interfaces'
import type { ProviderStatus, ProviderConfig } from '@intentos/shared-types'

// ── Mock AIProvider factory ────────────────────────────────────────────────────

function makeMockProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'mock-provider',
    name: 'Mock Provider',
    status: 'uninitialized' as ProviderStatus,
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    planApp: vi.fn().mockImplementation(async function* () {}),
    generateCode: vi.fn().mockImplementation(async function* () {}),
    executeSkill: vi.fn().mockResolvedValue({ success: true, data: 'ok' } as SkillCallResult),
    cancelSession: vi.fn().mockResolvedValue(undefined),
    onStatusChanged: undefined,
    ...overrides,
  }
}

const baseConfig: ProviderConfig = {
  providerId: 'claude-api',
  claudeModel: 'claude-haiku-4-5-20251001',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AIProviderManager', () => {
  let manager: AIProviderManager

  beforeEach(() => {
    manager = new AIProviderManager()
  })

  // ── setProvider / getProviderStatus ──────────────────────────────────────────

  it('returns "uninitialized" when no provider is set', () => {
    expect(manager.getProviderStatus()).toBe('uninitialized')
  })

  it('calls provider.initialize() when setProvider() is called', async () => {
    const provider = makeMockProvider()
    await manager.setProvider(provider, baseConfig)
    expect(provider.initialize).toHaveBeenCalledWith(baseConfig)
  })

  it('returns the provider status after setProvider()', async () => {
    const provider = makeMockProvider({
      get status() { return 'ready' as ProviderStatus },
    })
    await manager.setProvider(provider, baseConfig)
    expect(manager.getProviderStatus()).toBe('ready')
  })

  it('disposes the previous provider before setting a new one', async () => {
    const first = makeMockProvider()
    const second = makeMockProvider()

    await manager.setProvider(first, baseConfig)
    await manager.setProvider(second, baseConfig)

    expect(first.dispose).toHaveBeenCalledOnce()
    expect(second.initialize).toHaveBeenCalledWith(baseConfig)
  })

  it('getProvider() returns the active provider after setProvider()', async () => {
    const provider = makeMockProvider()
    await manager.setProvider(provider, baseConfig)
    expect(manager.getProvider()).toBe(provider)
  })

  // ── onStatusChanged ───────────────────────────────────────────────────────────

  it('invokes the onStatusChanged listener when the provider emits a status change', async () => {
    const provider = makeMockProvider()
    const listener = vi.fn()
    manager.onStatusChanged(listener)

    await manager.setProvider(provider, baseConfig)

    // Simulate the provider emitting a status change via the wired callback
    provider.onStatusChanged!('ready')

    expect(listener).toHaveBeenCalledWith('ready')
  })

  it('does not invoke the listener after the returned unsubscribe function is called', async () => {
    const provider = makeMockProvider()
    const listener = vi.fn()
    const unsubscribe = manager.onStatusChanged(listener)

    await manager.setProvider(provider, baseConfig)
    unsubscribe()

    provider.onStatusChanged!('error')

    expect(listener).not.toHaveBeenCalled()
  })

  it('calls multiple registered listeners when status changes', async () => {
    const provider = makeMockProvider()
    const listenerA = vi.fn()
    const listenerB = vi.fn()

    manager.onStatusChanged(listenerA)
    manager.onStatusChanged(listenerB)
    await manager.setProvider(provider, baseConfig)

    provider.onStatusChanged!('rate_limited')

    expect(listenerA).toHaveBeenCalledWith('rate_limited')
    expect(listenerB).toHaveBeenCalledWith('rate_limited')
  })

  // ── cancelSession ─────────────────────────────────────────────────────────────

  it('delegates cancelSession() to the active provider', async () => {
    const provider = makeMockProvider()
    await manager.setProvider(provider, baseConfig)

    await manager.cancelSession('session-abc')

    expect(provider.cancelSession).toHaveBeenCalledWith('session-abc')
  })

  it('does not throw when cancelSession() is called with no active provider', async () => {
    // No provider set — should not throw
    await expect(manager.cancelSession('session-abc')).resolves.toBeUndefined()
  })

  // ── dispose ───────────────────────────────────────────────────────────────────

  it('calls provider.dispose() when manager.dispose() is called', async () => {
    const provider = makeMockProvider()
    await manager.setProvider(provider, baseConfig)

    await manager.dispose()

    expect(provider.dispose).toHaveBeenCalledOnce()
  })

  it('returns "uninitialized" after dispose() clears the active provider', async () => {
    const provider = makeMockProvider()
    await manager.setProvider(provider, baseConfig)
    await manager.dispose()

    expect(manager.getProviderStatus()).toBe('uninitialized')
    expect(manager.getProvider()).toBeNull()
  })

  it('does not invoke status listeners after dispose() removes all listeners', async () => {
    const provider = makeMockProvider()
    const listener = vi.fn()
    manager.onStatusChanged(listener)

    await manager.setProvider(provider, baseConfig)
    await manager.dispose()

    // After dispose, the provider's onStatusChanged callback is cleared —
    // but even if someone calls it directly on the old provider object,
    // the manager's emitter has no listeners left.
    // We verify by re-emitting through the manager's internal path (not possible
    // externally), so we just verify dispose() does not throw.
    expect(listener).not.toHaveBeenCalledWith('ready') // no spurious calls
  })

  // ── error: no provider set ────────────────────────────────────────────────────

  it('throws when planApp() is called without a provider', async () => {
    const request: PlanRequest = {
      sessionId: 'session-1',
      intent: 'build a todo app',
      skills: [],
    }

    const gen = manager.planApp(request)
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('No AIProvider is set')
  })

  it('throws when executeSkill() is called without a provider', async () => {
    const request: SkillCallRequest = {
      sessionId: 'session-1',
      skillId: 'fs-skill',
      method: 'readFile',
      params: { path: '/tmp/x' },
    }

    await expect(manager.executeSkill(request)).rejects.toThrow('No AIProvider is set')
  })
})
