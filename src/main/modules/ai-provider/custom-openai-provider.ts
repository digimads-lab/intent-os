/**
 * M-04 AI Provider — CustomOpenAIProvider (CR-001)
 *
 * Implements the AIProvider interface using the `openai` npm package to connect
 * to any OpenAI Chat Completions API compatible endpoint (OpenAI, Ollama, Azure, etc.).
 */

import OpenAI from 'openai'

import { apiKeyStore } from './api-key-store'
import { createBuildMCPServer } from './build-mcp-server'
import type { BuildMCPServer } from './build-mcp-server'
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
  CustomProviderConfig,
  PlanChunk,
  GenProgressChunk,
  PlanResult,
} from './interfaces'

// ── ProviderError (reuse from claude-api-provider) ──────────────────────────

class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// ── Helper: parse plan result from accumulated text ─────────────────────────

function parsePlanResult(text: string): PlanResult | undefined {
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
      return parsed as PlanResult
    }
  } catch {
    // parse failed
  }
  return undefined
}

// ── Helper: build plan system prompt (OpenAI-adapted, no Claude-specific tags) ─

function buildPlanSystemPrompt(skills: import('./interfaces').SkillMeta[]): string {
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

// ── Helper: build generate system prompt (OpenAI-adapted) ───────────────────

function buildGenerateSystemPrompt(plan: PlanResult): string {
  const moduleList = plan.modules
    .map((m) => `  - ${m.name} (${m.filePath}): ${m.description}`)
    .join('\n')

  const skillList = plan.skillUsage
    .map((s) => `  - skillId: ${s.skillId}, methods: [${s.methods.join(', ')}]`)
    .join('\n')

  return `You are an expert TypeScript + React developer generating a SkillApp for IntentOS.

## App to generate
Name: ${plan.appName}
Description: ${plan.description}

## Required modules
${moduleList}

## Skills used
${skillList}

## Technology constraints
- React 18 + TypeScript (strict mode)
- Electron renderer process (no Node.js APIs in renderer)
- Entry point must be src/main.tsx (renders into #root)
- Output directory structure:
    src/
      main.tsx        - app entry point
      App.tsx         - root React component
      components/     - reusable components
    package.json      - with "main": "dist/main.js", scripts: { build: "tsc" }
    tsconfig.json     - strict TypeScript config targeting ES2020

## Instructions
1. Write all source files using write_file.
2. After writing, run tsc --noEmit to validate types.
3. If tsc reports errors, fix them by rewriting the affected files.
4. Once tsc passes, run npm run build to produce the bundle.
5. Do not write any files outside the target directory.
6. Keep components small and focused. No unnecessary dependencies.`
}

// ── Helper: build messages ──────────────────────────────────────────────────

function buildMessages(
  intent: string,
  contextHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (contextHistory ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))

  return [
    ...history,
    { role: 'user' as const, content: intent },
  ]
}

// ── Tool definitions for code generation (OpenAI function calling format) ───

const CODEGEN_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' }, description: 'Optional argument list' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the content of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
]

// ── Progress mapping ────────────────────────────────────────────────────────

const ESTIMATED_FILE_COUNT = 8

function mapToolCallToProgress(
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string,
  fileIndex: number
): GenProgressChunk {
  if (toolName === 'write_file') {
    const filePath = (args['path'] as string) ?? 'unknown'
    const perFileProgress = ESTIMATED_FILE_COUNT > 0 ? 65 / ESTIMATED_FILE_COUNT : 10
    const progress = Math.min(5 + Math.round(fileIndex * perFileProgress), 70)
    return { sessionId, stage: 'codegen', progress, message: `生成 ${filePath}`, filePath }
  }

  if (toolName === 'run_command') {
    const command = (args['command'] as string) ?? ''
    const cmdArgs = (args['args'] as string[]) ?? []
    const fullCmd = [command, ...cmdArgs].join(' ')
    if (command === 'tsc' || fullCmd.includes('tsc')) {
      return { sessionId, stage: 'compile', progress: 80, message: '正在编译 TypeScript...' }
    }
    return { sessionId, stage: 'bundle', progress: 90, message: '正在打包...' }
  }

  return {
    sessionId,
    stage: 'codegen',
    progress: Math.min(5 + Math.round(fileIndex * 10), 70),
    message: `执行工具: ${toolName}`,
  }
}

// ── CustomOpenAIProvider ────────────────────────────────────────────────────

export class CustomOpenAIProvider implements AIProvider {
  readonly id = 'custom'

  get name(): string {
    if (!this.config) return 'Custom (OpenAI-compatible)'
    try {
      return `Custom (${new URL(this.config.customBaseUrl).hostname})`
    } catch {
      return 'Custom (OpenAI-compatible)'
    }
  }

  private client: OpenAI | null = null
  private config: CustomProviderConfig | null = null
  private _status: ProviderStatus = 'uninitialized'
  private controllers = new Map<string, AbortController>()

  onStatusChanged?: ((status: ProviderStatus) => void) | undefined

  // ── status ──────────────────────────────────────────────────────────────────

  get status(): ProviderStatus {
    return this._status
  }

  private setStatus(status: ProviderStatus): void {
    this._status = status
    this.onStatusChanged?.(status)
  }

  // ── initialize ─────────────────────────────────────────────────────────────

  async initialize(config: ProviderConfig): Promise<void> {
    if (config.providerId !== 'custom') {
      throw new ProviderError('PROVIDER_ERROR', 'CustomOpenAIProvider only accepts custom config.', false)
    }
    this.config = config
    this.setStatus('initializing')

    // Validate Base URL format
    try {
      new URL(config.customBaseUrl)
    } catch {
      this.setStatus('error')
      throw new ProviderError('INVALID_BASE_URL', `Invalid Base URL: ${config.customBaseUrl}`, false)
    }

    // Read API Key
    const apiKey = await apiKeyStore.getKey('custom')

    // Create OpenAI client
    this.client = new OpenAI({
      baseURL: config.customBaseUrl.replace(/\/+$/, ''),
      apiKey: apiKey ?? 'intentos-no-key',
    })

    // Test connection
    await this._testConnection()
    this.setStatus('ready')
  }

  // ── planApp ─────────────────────────────────────────────────────────────────

  async *planApp(request: PlanRequest): AsyncIterable<PlanChunk> {
    if (!this.client || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    try {
      const systemPrompt = buildPlanSystemPrompt(request.skills)
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...buildMessages(request.intent, request.contextHistory),
      ]

      const stream = await this.client.chat.completions.create(
        {
          model: this.config.customPlanModel,
          messages,
          stream: true,
        },
        { signal: controller.signal }
      )

      let accumulated = ''
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) {
          accumulated += delta
          yield {
            sessionId: request.sessionId,
            phase: 'planning',
            content: delta,
          } satisfies PlanChunk
        }
        if (chunk.choices[0]?.finish_reason === 'stop') {
          const planResult = parsePlanResult(accumulated)
          yield {
            sessionId: request.sessionId,
            phase: 'complete',
            content: '',
            ...(planResult ? { planResult } : {}),
          } satisfies PlanChunk
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        yield {
          sessionId: request.sessionId,
          phase: 'error',
          content: 'Session cancelled.',
        } satisfies PlanChunk
      } else {
        yield {
          sessionId: request.sessionId,
          phase: 'error',
          content: `Planning failed: ${(err as Error).message}`,
        } satisfies PlanChunk
      }
    } finally {
      this.controllers.delete(request.sessionId)
    }
  }

  // ── streamText ──────────────────────────────────────────────────────────

  async *streamText(request: StreamTextRequest): AsyncIterable<StreamTextChunk> {
    if (!this.client || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ]

      const stream = await this.client.chat.completions.create(
        {
          model: this.config.customPlanModel,
          messages,
          stream: true,
        },
        { signal: controller.signal },
      )

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) {
          yield {
            sessionId: request.sessionId,
            content: delta,
            done: false,
          } satisfies StreamTextChunk
        }
        if (chunk.choices[0]?.finish_reason === 'stop') {
          yield {
            sessionId: request.sessionId,
            content: '',
            done: true,
          } satisfies StreamTextChunk
        }
      }
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

  // ── generateCode ──────────────────────────────────────────────────────────

  async *generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk> {
    if (!this.client || !this.config) {
      throw new ProviderError('PROVIDER_ERROR', 'Provider is not initialized.', false)
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    const mcpServer: BuildMCPServer = createBuildMCPServer(request.targetDir)

    try {
      const systemPrompt = buildGenerateSystemPrompt(request.plan)
      const userMessage = `Generate the SkillApp as described. App ID: ${request.appId}. Plan details:\n${JSON.stringify(request.plan, null, 2)}`

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ]

      let fileIndex = 0
      let iteration = 0
      const maxIterations = 30

      while (iteration < maxIterations) {
        iteration++

        if (controller.signal.aborted) break

        const response = await this.client.chat.completions.create(
          {
            model: this.config.customCodegenModel,
            messages,
            tools: CODEGEN_TOOLS,
            tool_choice: 'auto',
          },
          { signal: controller.signal }
        )

        const message = response.choices[0].message
        messages.push(message)

        const toolCalls = message.tool_calls
        if (!toolCalls || toolCalls.length === 0) {
          // No tool calls — check if model supports function calling
          if (iteration === 1 && fileIndex === 0) {
            throw new ProviderError(
              'TOOL_CALL_UNSUPPORTED',
              `Model ${this.config.customCodegenModel} does not support function calling.`,
              false
            )
          }
          break
        }

        for (const toolCall of toolCalls) {
          // Only handle function-type tool calls
          if (toolCall.type !== 'function') continue

          let args: Record<string, unknown>
          try {
            args = JSON.parse(toolCall.function.arguments)
          } catch {
            args = {}
          }

          // Execute tool
          let resultContent: string
          try {
            const result = await mcpServer.execute(toolCall.function.name, args)
            resultContent = JSON.stringify(result)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            resultContent = JSON.stringify({ error: errMsg })
          }

          // Yield progress
          yield mapToolCallToProgress(toolCall.function.name, args, request.sessionId, fileIndex)
          if (toolCall.function.name === 'write_file') fileIndex++

          messages.push({
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: resultContent,
          })
        }

        if (response.choices[0].finish_reason === 'stop') break
      }
    } finally {
      this.controllers.delete(request.sessionId)
      mcpServer.dispose()
    }

    // Final completion chunk
    yield {
      sessionId: request.sessionId,
      stage: 'complete',
      progress: 100,
      message: '应用生成完成',
      entryPoint: 'main.js',
      outputDir: request.targetDir,
    } as GenProgressChunk
  }

  // ── executeSkill ──────────────────────────────────────────────────────────

  async executeSkill(request: SkillCallRequest): Promise<SkillCallResult> {
    if (!this.client || !this.config) {
      return {
        success: false,
        error: 'Provider is not initialized.',
        errorCode: 'PROVIDER_ERROR',
      }
    }

    const controller = new AbortController()
    this.controllers.set(request.sessionId, controller)

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.config.customPlanModel,
          messages: [
            {
              role: 'user',
              content: `Execute skill ${request.skillId}.${request.method} with params: ${JSON.stringify(request.params)}`,
            },
          ],
        },
        { signal: controller.signal }
      )

      const text = response.choices[0]?.message?.content ?? ''
      return { success: true, data: text }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { success: false, error: 'Skill execution was cancelled.', errorCode: 'SESSION_CANCELLED' }
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

  // ── cancelSession ─────────────────────────────────────────────────────────

  async cancelSession(sessionId: string): Promise<void> {
    const controller = this.controllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.controllers.delete(sessionId)
    }
  }

  // ── dispose ───────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    this.setStatus('disposing')
    for (const [, ctrl] of this.controllers) {
      ctrl.abort()
    }
    this.controllers.clear()
    this.client = null
    this.config = null
  }

  // ── _testConnection ───────────────────────────────────────────────────────

  private async _testConnection(): Promise<void> {
    try {
      await this.client!.chat.completions.create({
        model: this.config!.customPlanModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 2048,
      })
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        if (err.status === 401) {
          this.setStatus('error')
          throw new ProviderError('API_KEY_INVALID', 'API Key is invalid (HTTP 401).', false)
        }
        if (err.status === 404) {
          this.setStatus('error')
          throw new ProviderError(
            'MODEL_NOT_FOUND',
            `Model ${this.config!.customPlanModel} not found (HTTP 404).`,
            false
          )
        }
        this.setStatus('error')
        throw new ProviderError('CUSTOM_PROVIDER_UNREACHABLE', err.message, false)
      }

      const errAny = err as Record<string, unknown>
      if (errAny.code === 'ECONNREFUSED' || errAny.code === 'ENOTFOUND') {
        this.setStatus('error')
        throw new ProviderError(
          'CUSTOM_PROVIDER_UNREACHABLE',
          `Cannot connect to ${this.config!.customBaseUrl}`,
          false
        )
      }

      this.setStatus('error')
      throw err
    }
  }
}
