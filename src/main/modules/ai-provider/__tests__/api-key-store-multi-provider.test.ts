/**
 * Unit tests for APIKeyStore multi-provider key storage (CR-001 / CR3-T2)
 *
 * Tests the new setKey/getKey/deleteKey methods and verifies isolation
 * between provider IDs. Also tests backward compatibility of deprecated methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// ── Electron mock ──────────────────────────────────────────────────────────────

const TEST_USER_DATA = path.join(os.tmpdir(), `intentos-test-multi-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => TEST_USER_DATA),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

async function freshStore() {
  const mod = await import('../api-key-store')
  return mod.apiKeyStore
}

const KEY_FILES = [
  'intentos-api-key.enc',
  'intentos-api-key.b64',
  'intentos-apikey-claude-api.enc',
  'intentos-apikey-claude-api.b64',
  'intentos-apikey-custom.enc',
  'intentos-apikey-custom.b64',
]

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('APIKeyStore — multi-provider (CR-001)', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_USER_DATA, { recursive: true })
    for (const name of KEY_FILES) {
      await fs.unlink(path.join(TEST_USER_DATA, name)).catch(() => {})
    }
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(async () => {
    delete process.env.ANTHROPIC_API_KEY
    for (const name of KEY_FILES) {
      await fs.unlink(path.join(TEST_USER_DATA, name)).catch(() => {})
    }
  })

  // ── setKey / getKey round-trip ──────────────────────────────────────────────

  it('getKey returns the key saved with setKey for claude-api', async () => {
    const store = await freshStore()
    await store.setKey('claude-api', 'sk-claude-test-123')
    const key = await store.getKey('claude-api')
    expect(key).toBe('sk-claude-test-123')
  })

  it('getKey returns the key saved with setKey for custom', async () => {
    const store = await freshStore()
    await store.setKey('custom', 'custom-key-456')
    const key = await store.getKey('custom')
    expect(key).toBe('custom-key-456')
  })

  // ── Isolation ──────────────────────────────────────────────────────────────

  it('keys for different providers are isolated', async () => {
    const store = await freshStore()
    await store.setKey('claude-api', 'claude-key')
    await store.setKey('custom', 'custom-key')

    expect(await store.getKey('claude-api')).toBe('claude-key')
    expect(await store.getKey('custom')).toBe('custom-key')
  })

  it('deleting one provider key does not affect the other', async () => {
    const store = await freshStore()
    await store.setKey('claude-api', 'claude-key')
    await store.setKey('custom', 'custom-key')

    await store.deleteKey('claude-api')

    expect(await store.getKey('claude-api')).toBeNull()
    expect(await store.getKey('custom')).toBe('custom-key')
  })

  // ── deleteKey ──────────────────────────────────────────────────────────────

  it('getKey returns null after deleteKey for custom', async () => {
    const store = await freshStore()
    await store.setKey('custom', 'custom-key')
    await store.deleteKey('custom')
    expect(await store.getKey('custom')).toBeNull()
  })

  it('deleteKey does not throw when no key file exists', async () => {
    const store = await freshStore()
    await expect(store.deleteKey('custom')).resolves.toBeUndefined()
  })

  // ── getKey with no stored key ─────────────────────────────────────────────

  it('getKey returns null for a provider with no stored key', async () => {
    const store = await freshStore()
    expect(await store.getKey('custom')).toBeNull()
    expect(await store.getKey('claude-api')).toBeNull()
  })

  // ── env var priority for claude-api ───────────────────────────────────────

  it('getKey("claude-api") returns ANTHROPIC_API_KEY env var when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key-abc'
    const store = await freshStore()
    expect(await store.getKey('claude-api')).toBe('env-key-abc')
  })

  it('getKey("custom") does NOT return ANTHROPIC_API_KEY env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key-abc'
    const store = await freshStore()
    expect(await store.getKey('custom')).toBeNull()
  })

  it('setKey("claude-api") is no-op when ANTHROPIC_API_KEY env var is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key-abc'
    const store = await freshStore()
    await store.setKey('claude-api', 'should-not-be-saved')

    const b64Path = path.join(TEST_USER_DATA, 'intentos-apikey-claude-api.b64')
    await expect(fs.access(b64Path)).rejects.toThrow()
  })

  it('setKey("custom") works even when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key-abc'
    const store = await freshStore()
    await store.setKey('custom', 'custom-key-xyz')
    expect(await store.getKey('custom')).toBe('custom-key-xyz')
  })

  // ── Overwrite ─────────────────────────────────────────────────────────────

  it('setKey overwrites the previous key for the same provider', async () => {
    const store = await freshStore()
    await store.setKey('custom', 'first')
    await store.setKey('custom', 'second')
    expect(await store.getKey('custom')).toBe('second')
  })

  // ── Backward compatibility ────────────────────────────────────────────────

  it('deprecated saveApiKey() still works', async () => {
    const store = await freshStore()
    await store.saveApiKey('legacy-key')
    const key = await store.loadApiKey()
    expect(key).toBe('legacy-key')
  })

  it('deprecated loadApiKey() returns null when no key saved', async () => {
    const store = await freshStore()
    expect(await store.loadApiKey()).toBeNull()
  })

  it('deprecated deleteApiKey() still works', async () => {
    const store = await freshStore()
    await store.saveApiKey('legacy-key')
    await store.deleteApiKey()
    expect(await store.loadApiKey()).toBeNull()
  })
})
