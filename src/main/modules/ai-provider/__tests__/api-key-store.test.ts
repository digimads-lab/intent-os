/**
 * Unit tests for APIKeyStore (ElectronAPIKeyStore)
 *
 * electron is mocked entirely so these tests run in a pure Node.js environment
 * without a running Electron process.  safeStorage.isEncryptionAvailable is set
 * to false so every test exercises the base64 fallback path, which is entirely
 * in-process (no OS keychain calls needed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

// ── Electron mock ──────────────────────────────────────────────────────────────

const TEST_USER_DATA = path.join(os.tmpdir(), `intentos-test-${process.pid}`)

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
  // Re-import to get a module that picks up the mocked electron on first load.
  // vitest module cache is reset between test files; within a file we use
  // dynamic import + resetModules to get a clean singleton each time.
  const mod = await import('../api-key-store')
  return mod.apiKeyStore
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('APIKeyStore', () => {
  beforeEach(async () => {
    // Ensure the temp directory exists and is empty before each test
    await fs.mkdir(TEST_USER_DATA, { recursive: true })
    // Remove any leftover key files
    for (const name of ['intentos-api-key.enc', 'intentos-api-key.b64']) {
      await fs.unlink(path.join(TEST_USER_DATA, name)).catch(() => {/* ignore ENOENT */})
    }
    // Clear env var
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(async () => {
    delete process.env.ANTHROPIC_API_KEY
    // Clean up written files
    for (const name of ['intentos-api-key.enc', 'intentos-api-key.b64']) {
      await fs.unlink(path.join(TEST_USER_DATA, name)).catch(() => {/* ignore */})
    }
  })

  // ── env var priority ──────────────────────────────────────────────────────────

  it('returns the ANTHROPIC_API_KEY env var value when it is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-test-key-123'
    const store = await freshStore()
    const key = await store.loadApiKey()
    expect(key).toBe('env-test-key-123')
  })

  it('hasApiKey() returns true when ANTHROPIC_API_KEY env var is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-test-key-123'
    const store = await freshStore()
    expect(await store.hasApiKey()).toBe(true)
  })

  it('saveApiKey() is a no-op when ANTHROPIC_API_KEY env var is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-test-key-123'
    const store = await freshStore()

    // Should not throw and should not write a file
    await expect(store.saveApiKey('other-key')).resolves.toBeUndefined()

    const b64Path = path.join(TEST_USER_DATA, 'intentos-api-key.b64')
    await expect(fs.access(b64Path)).rejects.toThrow() // file must NOT exist
  })

  it('deleteApiKey() is a no-op when ANTHROPIC_API_KEY env var is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-test-key-123'
    const store = await freshStore()
    // Should not throw
    await expect(store.deleteApiKey()).resolves.toBeUndefined()
  })

  // ── no stored key ─────────────────────────────────────────────────────────────

  it('loadApiKey() returns null when no env var is set and no key has been stored', async () => {
    const store = await freshStore()
    const key = await store.loadApiKey()
    expect(key).toBeNull()
  })

  it('hasApiKey() returns false when no env var and no stored key', async () => {
    const store = await freshStore()
    expect(await store.hasApiKey()).toBe(false)
  })

  // ── save / load round-trip ────────────────────────────────────────────────────

  it('loadApiKey() returns the key that was previously saved with saveApiKey()', async () => {
    const store = await freshStore()
    await store.saveApiKey('test-key-abc')
    const loaded = await store.loadApiKey()
    expect(loaded).toBe('test-key-abc')
  })

  it('hasApiKey() returns true after saveApiKey() has been called', async () => {
    const store = await freshStore()
    await store.saveApiKey('test-key-abc')
    expect(await store.hasApiKey()).toBe(true)
  })

  it('persists the key to disk (b64 file exists in userData directory)', async () => {
    const store = await freshStore()
    await store.saveApiKey('test-key-abc')

    const b64Path = path.join(TEST_USER_DATA, 'intentos-api-key.b64')
    await expect(fs.access(b64Path)).resolves.toBeUndefined()
  })

  // ── deleteApiKey ──────────────────────────────────────────────────────────────

  it('loadApiKey() returns null after deleteApiKey() is called', async () => {
    const store = await freshStore()
    await store.saveApiKey('test-key-abc')
    await store.deleteApiKey()
    const key = await store.loadApiKey()
    expect(key).toBeNull()
  })

  it('hasApiKey() returns false after deleteApiKey() is called', async () => {
    const store = await freshStore()
    await store.saveApiKey('test-key-abc')
    await store.deleteApiKey()
    expect(await store.hasApiKey()).toBe(false)
  })

  it('deleteApiKey() does not throw when no key file exists', async () => {
    const store = await freshStore()
    await expect(store.deleteApiKey()).resolves.toBeUndefined()
  })

  // ── overwrite ─────────────────────────────────────────────────────────────────

  it('loadApiKey() returns the most recently saved key when saveApiKey() is called twice', async () => {
    const store = await freshStore()
    await store.saveApiKey('first-key')
    await store.saveApiKey('second-key')
    const key = await store.loadApiKey()
    expect(key).toBe('second-key')
  })
})
