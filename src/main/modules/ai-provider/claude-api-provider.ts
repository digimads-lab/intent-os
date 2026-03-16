/**
 * ClaudeAPIProvider — M-04 AI Provider implementation using @anthropic-ai/sdk
 *
 * Implements the AIProvider interface via the Anthropic Claude API (HTTPS + SSE).
 * Handles:
 *  - initialize: load API key, validate with test request, manage status
 *  - planApp: streaming plan generation with exponential-backoff retry on 429
 *  - executeSkill: non-streaming skill execution
 *  - cancelSession: AbortController-based cancellation
 *  - dispose: clean up all active sessions
 *
 * generateCode is stubbed — implemented by B2 (claude-agent-sdk integration).
 */

import Anthropic from '@anthropic-ai/sdk'

import { apiKeyStore } from './api-key-store'
import { generateCodeImpl } from './claude-api-provider-generate'
import type { GenerateCodeProviderCtx } from './claude-api-provider-generate'
import type {
  AIProvider,
  PlanRequest,
  GenerateRequest,
  SkillCallRequest,
  SkillCallResult,
  StreamTextRequest,
  StreamTextChunk,
} from './interfaces'
import type {
  ProviderStatus,
  ProviderConfig,
  ClaudeProviderConfig,
  PlanChunk,
  GenProgressChunk,
  SkillMeta,
} from '@intentos/shared-types'

// ── ProviderError ─────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// ── Helper: build system prompt ────────────────────────────────────────────────

function buildPlanSystemPrompt(skills: SkillMeta[]): string {
  const skillList = skills
    .map(
      (s) =>
        `- skillId: ${s.id}\n  name: ${s.name}\n  description: ${s.description}\n  capabilities: ${s.capabilities.join(', ')}`
    )
    .join('\n')

  return `You are an IntentOS SkillApp planner. Your task is to design a SkillApp based on the user's intent and the available Skills.

Available Skills:
${skillList || '(none)'}

Output a valid JSON object with the following structure at the end of your response:
{
  "appName": "<short name for the app>",
  "description": "<what this app does>",
  "modules": [
    { "name": "<module name>", "description": "<what it does>", "filePath": "<relative file path>" }
  ],
  "skillUsage": [
    { "skillId": "<skill id>", "methods": ["<method1>", "<method2>"] }
  ]
}

## 交互规则

**如果用户意图缺少关键细节**（如未说明具体功能、使用场景不明确），请用以下格式追问：

---
我需要了解一些细节来设计最合适的应用：

**[简短问题标题]**
- A. [选项A描述]
- B. [选项B描述]
- C. 其他（请描述）

**[简短问题标题2]**（如需要）
- A. [选项A描述]
- B. [选项B描述]

请回复选项字母，或直接描述你的想法。输入「直接生成」可让我立即根据现有信息生成方案。
---

每轮最多问 2-3 个问题，选项要简洁。

**当你收集到足够信息后**（来自初始意图或追问回答），请用以下格式输出方案：

---
好的，根据你的需求，我来设计这个应用：

[1-2 句话描述设计思路]

\`\`\`json
{
  "appName": "...",
  "description": "...",
  "modules": [
    { "name": "...", "description": "...", "filePath": "..." }
  ],
  "skillUsage": [
    { "skillId": "...", "methods": ["..."] }
  ]
}
\`\`\`
---

JSON 块必须始终用 \`\`\`json ... \`\`\` 代码围栏包裹。`
}

// ── Helper: build messages array ───────────────────────────────────────────────

function buildMessages(
  intent: string,
  contextHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Anthropic.MessageParam[] {
  const history: Anthropic.MessageParam[] = (contextHistory ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))

  return [
    ...history,
    { role: 'user', content: intent },
  ]
}

// ── Helper: extract JSON plan result from accumulated text ─────────────────────

function parsePlanResult(text: string): import('@intentos/shared-types').PlanResult | undefined {
  // Walk backwards from the last '}' to find the matching '{' for the outermost JSON object.
  // Using lastIndexOf('{') is wrong — it finds the last (innermost) '{', e.g. a nested module entry.
  const lastClose = text.lastIndexOf('}')
  if (lastClose === -1) return undefined

  let depth = 0
  let start = -1
  for (let i = lastClose; i >= 0; i--) {
    if (text[i] === '}') depth++
    else if (text[i] === '{') {
      depth--
      if (depth === 0) {
        start = i
        break
      }
    }
  }
  if (start === -1) return undefined

  try {
    const parsed = JSON.parse(text.slice(start, lastClose + 1))
    if (
      typeof parsed.appName === 'string' &&
      typeof parsed.description === 'string' &&
      Array.isArray(parsed.modules) &&
      Array.isArray(parsed.skillUsage)
    ) {
      return parsed as import('@intentos/shared-types').PlanResult
    }
  } catch {
    // parse failed
  }
  return undefined
}

// ── Helper: sleep ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── ClaudeAPIProvider ─────────────────────────────────────────────────────────

export class ClaudeAPIProvider implements AIProvider {
  readonly id = 'claude-api'
  readonly name = 'Claude API'

  private anthropic: Anthropic | null = null
  private config: ClaudeProviderConfig | null = null
  private controllers = new Map<string, AbortController>()
  private _status: ProviderStatus = 'uninitialized'

  /** Alias required by GenerateCodeProviderCtx interface */
  get activeControllers(): Map<string, AbortController> {
    return this.controllers
  }

  onStatusChanged?: ((status: ProviderStatus) => void) | undefined

  // ── status getter ────────────────────────────────────────────────────────────

  get status(): ProviderStatus {
    return this._status
  }

  private setStatus(status: ProviderStatus): void {
    this._status = status
    this.onStatusChanged?.(status)
  }

  // ── initialize ───────────────────────────────────────────────────────────────

  async initialize(config: ProviderConfig): Promise<void> {
    if (config.providerId !== 'claude-api') {
      throw new ProviderError('PROVIDER_ERROR', 'ClaudeAPIProvider only accepts claude-api config.', false)
    }
    this.config = config
    this.setStatus('initializing')

    // Load API key from store (env var takes priority inside apiKeyStore)
    const apiKey = await apiKeyStore.loadApiKey()

    if (!apiKey) {
      this.setStatus('error')
      throw new ProviderError('API_KEY_MISSING', 'Anthropic API key is not configured.', false)
    }

    // Build Anthropic client
    const clientOptions: { apiKey: string; baseURL?: string } = { apiKey }
    const baseURL = process.env.ANTHROPIC_BASE_URL
    if (baseURL) {
      clientOptions.baseURL = baseURL
    }

    this.anthropic = new Anthropic(clientOptions)

    // Validate key with a lightweight test request (10 s timeout)
    const initController = new AbortController()
    const timeoutId = setTimeout(() => initController.abort(), 10_000)

    try {
      await this.anthropic.messages.create(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        },
        { signal: initController.signal }
      )
      this.setStatus('ready')
    } catch (err) {
      this.setStatus('error')

      if (err instanceof Anthropic.APIError) {
        if (err.status === 401) {
          throw new ProviderError(
            'API_KEY_INVALID',
            `Anthropic API key is invalid (HTTP 401): ${err.message}`,
            false
          )
        }
        throw new ProviderError(
          'PROVIDER_ERROR',
          `Anthropic API error (HTTP ${err.status}): ${err.message}`,
          true
        )
      }

      // AbortError → timeout
      if ((err as Error).name === 'AbortError') {
        throw new ProviderError(
          'NETWORK_TIMEOUT',
          'Anthropic API connection timed out (10 s).',
          false
        )
      }

      // Any other error (fetch/network failure)
      throw new ProviderError(
        'NETWORK_UNAVAILABLE',
        `Network error during initialization: ${(err as Error).message}`,
        false
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ── planApp ──────────────────────────────────────────────────────────────────

  async *planApp(request: PlanRequest): AsyncIterable<PlanChunk> {
    if (!this.anthropic || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    const MAX_RETRIES = 3
    const RETRY_DELAYS = [1_000, 2_000, 4_000]

    let attempt = 0

    while (true) {
      try {
        const stream = this.anthropic.messages.stream(
          {
            model: this.config.claudeModel ?? 'claude-opus-4-6',
            max_tokens: 4096,
            system: buildPlanSystemPrompt(request.skills),
            messages: buildMessages(request.intent, request.contextHistory),
          },
          { signal: controller.signal }
        )

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield {
              sessionId: request.sessionId,
              phase: 'planning',
              content: event.delta.text,
            } satisfies PlanChunk
          }
        }

        // Parse plan result from accumulated response
        const finalMessage = await stream.finalMessage()
        const fullText =
          finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : ''
        const planResult = parsePlanResult(fullText)

        yield {
          sessionId: request.sessionId,
          phase: 'complete',
          content: '',
          ...(planResult ? { planResult } : {}),
        } satisfies PlanChunk

        // Success — exit retry loop
        break
      } catch (err) {
        // AbortError: user cancelled — yield error chunk and exit silently
        if ((err as Error).name === 'AbortError') {
          yield {
            sessionId: request.sessionId,
            phase: 'error',
            content: 'Session cancelled.',
          } satisfies PlanChunk
          break
        }

        // 429 Rate Limited: retry with exponential backoff
        if (err instanceof Anthropic.APIError && err.status === 429) {
          if (attempt < MAX_RETRIES) {
            this.setStatus('rate_limited')
            await sleep(RETRY_DELAYS[attempt] ?? 4_000)
            attempt++
            // Restore ready status before retrying (will be set again if another 429)
            if (this._status === 'rate_limited') {
              this.setStatus('ready')
            }
            continue
          }
          // Exhausted retries
          yield {
            sessionId: request.sessionId,
            phase: 'error',
            content: 'API rate limit exceeded after 3 retries.',
          } satisfies PlanChunk
          break
        }

        // Other API or network errors
        yield {
          sessionId: request.sessionId,
          phase: 'error',
          content: `Planning failed: ${(err as Error).message}`,
        } satisfies PlanChunk
        break
      }
    }

    // Clean up controller after the retry loop exits (success or final failure)
    this.controllers.delete(request.sessionId)
  }

  // ── streamText ───────────────────────────────────────────────────────────────

  async *streamText(request: StreamTextRequest): AsyncIterable<StreamTextChunk> {
    if (!this.anthropic || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    try {
      const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const stream = this.anthropic.messages.stream(
        {
          model: this.config.claudeModel ?? 'claude-opus-4-6',
          max_tokens: 8192,
          system: request.systemPrompt,
          messages,
        },
        { signal: controller.signal },
      )

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield {
            sessionId: request.sessionId,
            content: event.delta.text,
            done: false,
          } satisfies StreamTextChunk
        }
      }

      yield {
        sessionId: request.sessionId,
        content: '',
        done: true,
      } satisfies StreamTextChunk
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        yield { sessionId: request.sessionId, content: '', done: true } satisfies StreamTextChunk
      } else {
        throw err
      }
    } finally {
      this.controllers.delete(request.sessionId)
    }
  }

  // ── generateCode ─────────────────────────────────────────────────────────────

  async *generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk> {
    if (!this.anthropic || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }
    yield* generateCodeImpl.call(this as unknown as GenerateCodeProviderCtx, request)
  }

  // ── executeSkill ─────────────────────────────────────────────────────────────

  async executeSkill(request: SkillCallRequest): Promise<SkillCallResult> {
    if (!this.anthropic || !this.config) {
      return {
        success: false,
        error: 'Provider is not initialized.',
        errorCode: 'PROVIDER_ERROR',
      }
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    try {
      const response = await this.anthropic.messages.create(
        {
          model: this.config.claudeModel ?? 'claude-opus-4-6',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `Execute skill ${request.skillId}.${request.method} with params: ${JSON.stringify(request.params)}`,
            },
          ],
        },
        { signal: controller.signal }
      )

      const text =
        response.content[0]?.type === 'text' ? response.content[0].text : ''

      return { success: true, data: text }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return {
          success: false,
          error: 'Skill execution was cancelled.',
          errorCode: 'SESSION_CANCELLED',
        }
      }

      if (err instanceof Anthropic.APIError) {
        if (err.status === 401) {
          return {
            success: false,
            error: 'API key is invalid.',
            errorCode: 'API_KEY_INVALID',
          }
        }
        return {
          success: false,
          error: `Anthropic API error: ${err.message}`,
          errorCode: 'PROVIDER_ERROR',
        }
      }

      return {
        success: false,
        error: `Skill execution failed: ${(err as Error).message}`,
        errorCode: 'PROVIDER_ERROR',
      }
    } finally {
      this.controllers.delete(request.sessionId)
    }
  }

  // ── cancelSession ─────────────────────────────────────────────────────────────

  async cancelSession(sessionId: string): Promise<void> {
    const controller = this.controllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.controllers.delete(sessionId)
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    this.setStatus('disposing')

    // Abort all active sessions
    for (const [, controller] of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()

    this.anthropic = null
    this.config = null
  }
}
