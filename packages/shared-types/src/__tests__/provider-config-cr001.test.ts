/**
 * CR-001 ProviderConfig type tests (CR3-T4)
 *
 * Validates that the discriminated union ProviderConfig works correctly
 * for all provider types and that old claude-api configs parse correctly.
 */

import { describe, it, expect } from 'vitest'

import {
  ProviderConfigSchema,
  ClaudeProviderConfigSchema,
  CustomProviderConfigSchema,
  ProviderErrorCodeSchema,
  ProviderTypeSchema,
} from '../provider'

// ── ProviderConfigSchema ─────────────────────────────────────────────────────

describe('ProviderConfigSchema (discriminated union)', () => {
  // ── Claude API branch ─────────────────────────────────────────────────────

  it('accepts a minimal claude-api config', () => {
    const result = ProviderConfigSchema.safeParse({ providerId: 'claude-api' })
    expect(result.success).toBe(true)
  })

  it('accepts a full claude-api config with optional fields', () => {
    const result = ProviderConfigSchema.safeParse({
      providerId: 'claude-api',
      claudeApiKey: 'sk-ant-test',
      claudeModel: 'claude-haiku-4-5-20251001',
      claudeCodegenModel: 'claude-sonnet-4-20250514',
    })
    expect(result.success).toBe(true)
  })

  // ── Custom branch ─────────────────────────────────────────────────────────

  it('accepts a valid custom config', () => {
    const result = ProviderConfigSchema.safeParse({
      providerId: 'custom',
      customBaseUrl: 'http://localhost:11434/v1',
      customPlanModel: 'llama3',
      customCodegenModel: 'llama3',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a custom config with empty customBaseUrl', () => {
    const result = ProviderConfigSchema.safeParse({
      providerId: 'custom',
      customBaseUrl: '',
      customPlanModel: 'llama3',
      customCodegenModel: 'llama3',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a custom config missing required fields', () => {
    const result = ProviderConfigSchema.safeParse({
      providerId: 'custom',
      customBaseUrl: 'http://localhost:11434/v1',
      // missing customPlanModel and customCodegenModel
    })
    expect(result.success).toBe(false)
  })

  // ── OpenClaw branch ───────────────────────────────────────────────────────

  it('accepts a minimal openclaw config', () => {
    const result = ProviderConfigSchema.safeParse({ providerId: 'openclaw' })
    expect(result.success).toBe(true)
  })

  it('accepts an openclaw config with optional fields', () => {
    const result = ProviderConfigSchema.safeParse({
      providerId: 'openclaw',
      openclawHost: 'localhost',
      openclawPort: 8080,
    })
    expect(result.success).toBe(true)
  })

  // ── Invalid ───────────────────────────────────────────────────────────────

  it('rejects an unknown providerId', () => {
    const result = ProviderConfigSchema.safeParse({ providerId: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('rejects when providerId is missing', () => {
    const result = ProviderConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── ClaudeProviderConfigSchema ──────────────────────────────────────────────

describe('ClaudeProviderConfigSchema', () => {
  it('accepts old-format config (just providerId)', () => {
    const result = ClaudeProviderConfigSchema.safeParse({
      providerId: 'claude-api',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-claude providerId', () => {
    const result = ClaudeProviderConfigSchema.safeParse({
      providerId: 'custom',
    })
    expect(result.success).toBe(false)
  })
})

// ── CustomProviderConfigSchema ──────────────────────────────────────────────

describe('CustomProviderConfigSchema', () => {
  it('accepts a valid custom config', () => {
    const result = CustomProviderConfigSchema.safeParse({
      providerId: 'custom',
      customBaseUrl: 'https://api.openai.com/v1',
      customPlanModel: 'gpt-4o',
      customCodegenModel: 'gpt-4o',
    })
    expect(result.success).toBe(true)
  })

  it('rejects when customPlanModel is empty', () => {
    const result = CustomProviderConfigSchema.safeParse({
      providerId: 'custom',
      customBaseUrl: 'http://localhost:11434/v1',
      customPlanModel: '',
      customCodegenModel: 'llama3',
    })
    expect(result.success).toBe(false)
  })
})

// ── CR-001 Error codes ──────────────────────────────────────────────────────

describe('ProviderErrorCodeSchema — CR-001 codes', () => {
  it.each([
    'INVALID_BASE_URL',
    'MODEL_NOT_FOUND',
    'CUSTOM_PROVIDER_UNREACHABLE',
    'TOOL_CALL_UNSUPPORTED',
  ])('accepts CR-001 error code: %s', (code) => {
    const result = ProviderErrorCodeSchema.safeParse(code)
    expect(result.success).toBe(true)
  })

  it('still accepts pre-existing error codes', () => {
    for (const code of ['API_KEY_INVALID', 'RATE_LIMITED', 'PROVIDER_ERROR', 'SESSION_CANCELLED']) {
      expect(ProviderErrorCodeSchema.safeParse(code).success).toBe(true)
    }
  })
})

// ── ProviderTypeSchema ──────────────────────────────────────────────────────

describe('ProviderTypeSchema', () => {
  it.each(['claude-api', 'custom', 'openclaw'])('accepts: %s', (type) => {
    expect(ProviderTypeSchema.safeParse(type).success).toBe(true)
  })

  it('rejects unknown provider type', () => {
    expect(ProviderTypeSchema.safeParse('gemini').success).toBe(false)
  })
})
