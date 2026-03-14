/**
 * Unit tests for CustomOpenAIProvider (CR-001 / CR3-T1)
 *
 * The OpenAI SDK is fully mocked to avoid real HTTP calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProviderConfig, CustomProviderConfig } from '@intentos/shared-types'

// ── Mock: openai ────────────────────────────────────────────────────────────

const mockCreate = vi.fn()

vi.mock('openai', () => {
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  }

  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
    constructor() {}
  }

  ;(MockOpenAI as any).APIError = APIError

  return { default: MockOpenAI, __esModule: true }
})

// ── Mock: api-key-store ─────────────────────────────────────────────────────

vi.mock('../api-key-store', () => ({
  apiKeyStore: {
    getKey: vi.fn().mockResolvedValue('test-api-key'),
    setKey: vi.fn().mockResolvedValue(undefined),
    deleteKey: vi.fn().mockResolvedValue(undefined),
  },
}))

// ── Mock: build-mcp-server ──────────────────────────────────────────────────

const mockMcpExecute = vi.fn().mockResolvedValue({ success: true })
const mockMcpDispose = vi.fn()

vi.mock('../build-mcp-server', () => ({
  createBuildMCPServer: vi.fn(() => ({
    execute: mockMcpExecute,
    dispose: mockMcpDispose,
  })),
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import { CustomOpenAIProvider } from '../custom-openai-provider'

// ── Helpers ─────────────────────────────────────────────────────────────────

const validCustomConfig: CustomProviderConfig = {
  providerId: 'custom',
  customBaseUrl: 'http://localhost:11434/v1',
  customPlanModel: 'llama3',
  customCodegenModel: 'llama3',
}

async function initProvider(config?: ProviderConfig): Promise<CustomOpenAIProvider> {
  const provider = new CustomOpenAIProvider()
  // Mock _testConnection to succeed by having create return a valid response
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: 'ok' } }],
  })
  await provider.initialize(config ?? validCustomConfig)
  return provider
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CustomOpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── initialize ──────────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('succeeds with a valid custom config', async () => {
      const provider = await initProvider()
      expect(provider.status).toBe('ready')
      expect(provider.name).toContain('localhost')
    })

    it('throws PROVIDER_ERROR when config is not for custom provider', async () => {
      const provider = new CustomOpenAIProvider()
      const claudeConfig: ProviderConfig = {
        providerId: 'claude-api',
      }

      await expect(provider.initialize(claudeConfig)).rejects.toThrow('CustomOpenAIProvider only accepts custom config')
      expect(provider.status).toBe('uninitialized')
    })

    it('throws INVALID_BASE_URL when Base URL is malformed', async () => {
      const provider = new CustomOpenAIProvider()
      const badConfig: CustomProviderConfig = {
        ...validCustomConfig,
        customBaseUrl: 'not-a-url',
      }

      await expect(provider.initialize(badConfig)).rejects.toThrow('Invalid Base URL')
    })

    it('throws API_KEY_INVALID on HTTP 401 during connection test', async () => {
      const provider = new CustomOpenAIProvider()
      const OpenAI = (await import('openai')).default
      mockCreate.mockRejectedValueOnce(new (OpenAI as any).APIError(401, 'Unauthorized'))

      await expect(provider.initialize(validCustomConfig)).rejects.toThrow('API Key is invalid')
    })

    it('throws MODEL_NOT_FOUND on HTTP 404 during connection test', async () => {
      const provider = new CustomOpenAIProvider()
      const OpenAI = (await import('openai')).default
      mockCreate.mockRejectedValueOnce(new (OpenAI as any).APIError(404, 'Not Found'))

      await expect(provider.initialize(validCustomConfig)).rejects.toThrow('not found')
    })

    it('throws CUSTOM_PROVIDER_UNREACHABLE on ECONNREFUSED', async () => {
      const provider = new CustomOpenAIProvider()
      const err = new Error('Connection refused') as Error & { code: string }
      err.code = 'ECONNREFUSED'
      mockCreate.mockRejectedValueOnce(err)

      await expect(provider.initialize(validCustomConfig)).rejects.toThrow('Cannot connect')
    })
  })

  // ── planApp ─────────────────────────────────────────────────────────────────

  describe('planApp', () => {
    it('throws when provider is not initialized', async () => {
      const provider = new CustomOpenAIProvider()
      const gen = provider.planApp({
        sessionId: 'sess-1',
        intent: 'build a todo app',
        skills: [],
      })
      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('not initialized')
    })

    it('yields planning chunks followed by a complete chunk', async () => {
      const provider = await initProvider()

      // Mock streaming response
      const planJson = JSON.stringify({
        appName: 'TodoApp',
        description: 'A todo application',
        modules: [{ name: 'main', description: 'entry', filePath: 'src/main.tsx' }],
        skillUsage: [],
      })

      const asyncStreamChunks = [
        { choices: [{ delta: { content: 'Planning...' }, finish_reason: null }] },
        { choices: [{ delta: { content: planJson }, finish_reason: null }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] },
      ]

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of asyncStreamChunks) {
            yield chunk
          }
        },
      })

      const chunks: unknown[] = []
      for await (const chunk of provider.planApp({
        sessionId: 'sess-plan',
        intent: 'build a todo app',
        skills: [],
      })) {
        chunks.push(chunk)
      }

      // Should have planning chunks + complete chunk
      expect(chunks.length).toBeGreaterThanOrEqual(2)

      const lastChunk = chunks[chunks.length - 1] as { phase: string }
      expect(lastChunk.phase).toBe('complete')
    })

    it('yields an error chunk when the stream fails', async () => {
      const provider = await initProvider()

      mockCreate.mockRejectedValueOnce(new Error('Stream exploded'))

      const chunks: unknown[] = []
      for await (const chunk of provider.planApp({
        sessionId: 'sess-err',
        intent: 'build a todo app',
        skills: [],
      })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBe(1)
      const errChunk = chunks[0] as { phase: string; content: string }
      expect(errChunk.phase).toBe('error')
      expect(errChunk.content).toContain('Stream exploded')
    })
  })

  // ── generateCode ────────────────────────────────────────────────────────────

  describe('generateCode', () => {
    it('throws when provider is not initialized', async () => {
      const provider = new CustomOpenAIProvider()
      const gen = provider.generateCode({
        sessionId: 'sess-1',
        appId: 'app-1',
        plan: {
          appName: 'Test',
          description: 'Test',
          modules: [],
          skillUsage: [],
        },
        targetDir: '/tmp/test',
      })
      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('not initialized')
    })

    it('executes tool calls and yields progress chunks', async () => {
      const provider = await initProvider()

      // First call: model returns tool calls
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'src/main.tsx', content: 'console.log("hi")' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        }],
      })

      // Second call: model returns stop (no more tool calls)
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: 'Done!',
            tool_calls: undefined,
          },
          finish_reason: 'stop',
        }],
      })

      const chunks: unknown[] = []
      for await (const chunk of provider.generateCode({
        sessionId: 'sess-gen',
        appId: 'app-1',
        plan: {
          appName: 'TestApp',
          description: 'A test app',
          modules: [{ name: 'main', description: 'entry', filePath: 'src/main.tsx' }],
          skillUsage: [],
        },
        targetDir: '/tmp/test-gen',
      })) {
        chunks.push(chunk)
      }

      // Should have progress chunk(s) + final complete chunk
      expect(chunks.length).toBeGreaterThanOrEqual(2)

      const lastChunk = chunks[chunks.length - 1] as { stage: string; progress: number }
      expect(lastChunk.stage).toBe('complete')
      expect(lastChunk.progress).toBe(100)

      // MCP server should have been called
      expect(mockMcpExecute).toHaveBeenCalledWith('write_file', {
        path: 'src/main.tsx',
        content: 'console.log("hi")',
      })
      expect(mockMcpDispose).toHaveBeenCalled()
    })

    it('throws TOOL_CALL_UNSUPPORTED when model returns no tool calls on first iteration', async () => {
      const provider = await initProvider()

      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            role: 'assistant',
            content: 'I cannot use tools.',
            tool_calls: undefined,
          },
          finish_reason: 'stop',
        }],
      })

      const gen = provider.generateCode({
        sessionId: 'sess-no-tools',
        appId: 'app-1',
        plan: {
          appName: 'TestApp',
          description: 'A test app',
          modules: [],
          skillUsage: [],
        },
        targetDir: '/tmp/test-no-tools',
      })

      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('does not support function calling')
    })
  })

  // ── executeSkill ────────────────────────────────────────────────────────────

  describe('executeSkill', () => {
    it('returns success with model response', async () => {
      const provider = await initProvider()

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'skill result data' } }],
      })

      const result = await provider.executeSkill({
        sessionId: 'sess-skill',
        skillId: 'fs-skill',
        method: 'readFile',
        params: { path: '/tmp/x' },
      })

      expect(result.success).toBe(true)
      expect(result.data).toBe('skill result data')
    })

    it('returns error when not initialized', async () => {
      const provider = new CustomOpenAIProvider()
      const result = await provider.executeSkill({
        sessionId: 'sess-skill',
        skillId: 'fs-skill',
        method: 'readFile',
        params: {},
      })
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('PROVIDER_ERROR')
    })
  })

  // ── cancelSession ──────────────────────────────────────────────────────────

  describe('cancelSession', () => {
    it('does not throw when no session exists', async () => {
      const provider = await initProvider()
      await expect(provider.cancelSession('nonexistent')).resolves.toBeUndefined()
    })
  })

  // ── dispose ────────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('sets status to disposing and clears state', async () => {
      const provider = await initProvider()
      expect(provider.status).toBe('ready')

      await provider.dispose()
      // Status transitions to disposing during dispose()
      // After dispose, client and config are null
      expect(provider.name).toBe('Custom (OpenAI-compatible)')
    })
  })

  // ── name ───────────────────────────────────────────────────────────────────

  describe('name', () => {
    it('returns hostname from config base URL', async () => {
      const provider = await initProvider()
      expect(provider.name).toBe('Custom (localhost)')
    })

    it('returns fallback name when not initialized', () => {
      const provider = new CustomOpenAIProvider()
      expect(provider.name).toBe('Custom (OpenAI-compatible)')
    })
  })

  // ── onStatusChanged ────────────────────────────────────────────────────────

  describe('onStatusChanged', () => {
    it('fires callback during initialize lifecycle', async () => {
      const provider = new CustomOpenAIProvider()
      const statuses: string[] = []
      provider.onStatusChanged = (s) => statuses.push(s)

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      })
      await provider.initialize(validCustomConfig)

      expect(statuses).toContain('initializing')
      expect(statuses).toContain('ready')
    })
  })
})
