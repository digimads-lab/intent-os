# CR-001 技术方案（增量）— spec-delta.md

**关联 CR**：CR-001 支持自定义 URL + API Key 作为 AI Provider
**依据文档**：`CR-001/modules-delta.md`、`docs/spec/ai-provider-spec.md`、`docs/dev-docs/interfaces.md`
**变更性质**：在现有技术规格基础上的增量说明

---

## 1. 概述

CR-001 在 M-04 内新增 `CustomOpenAIProvider` 实现类，使用 `openai` npm 包对接任意 OpenAI Chat Completions 兼容端点。同时扩展 `ProviderConfig` 类型、`APIKeyStore` 多 Provider 存储、IPC channel 及 M-05 Prompt 适配逻辑。

**不修改**：`AIProvider` 抽象接口、`ClaudeAPIProvider`、请求队列管理、Unix Socket 协议、热更新协议、M-02/M-03/M-06 任何接口。

---

## 2. 类型变更

### 2.1 ProviderConfig 扩展（权威定义）

在 `docs/dev-docs/interfaces.md` § 6.2 和 `docs/dev-docs/shared-types.md` 中，`ProviderConfig` 由判别联合类型重新定义：

```typescript
// CR-001: ProviderConfig 改为判别联合类型
type ProviderConfig =
  | ClaudeProviderConfig
  | CustomProviderConfig
  | OpenClawProviderConfig;

interface ClaudeProviderConfig {
  providerId: 'claude-api';
  claudeModel?: string;           // 规划用模型，默认 'claude-opus-4-6'
  claudeCodegenModel?: string;    // 代码生成用模型，默认 'claude-sonnet-4-6'
}

// CR-001 新增
interface CustomProviderConfig {
  providerId: 'custom';
  customBaseUrl: string;          // 必填，如 'http://localhost:11434/v1'
  customPlanModel: string;        // 必填，规划阶段使用的模型名，如 'gpt-4o'
  customCodegenModel: string;     // 必填，代码生成阶段使用的模型名
  // API Key 不在此处存储，通过 APIKeyStore.getKey('custom') 读取
}

interface OpenClawProviderConfig {
  providerId: 'openclaw';
  openclawHost?: string;          // 默认 '127.0.0.1'
  openclawPort?: number;          // 默认 7890
}
```

**迁移说明**：现有持久化配置（存储在 userData 的 JSON 文件中）读取时若 `providerId` 缺失，视为 `'claude-api'` 以保持向后兼容。

---

### 2.2 AIProviderManager.setProvider() 参数扩展

```typescript
// 原有（扩展前）
switchProvider(config: ProviderConfig): Promise<void>;

// CR-001 后：ProviderConfig 联合类型已包含 'custom'，无需修改函数签名
// 实现层面：增加对 providerId === 'custom' 分支的处理
```

`AIProviderManager` 内部 `switchProvider` 实现增加 `custom` 分支：

```typescript
async switchProvider(config: ProviderConfig): Promise<void> {
  if (this.currentProvider) {
    await this.currentProvider.dispose();
  }
  switch (config.providerId) {
    case 'claude-api':
      this.currentProvider = new ClaudeAPIProvider();
      break;
    case 'custom':                          // CR-001 新增
      this.currentProvider = new CustomOpenAIProvider();
      break;
    case 'openclaw':
      this.currentProvider = new OpenClawProvider();
      break;
  }
  await this.currentProvider.initialize(config);
}
```

---

### 2.3 APIKeyStore 扩展

原有 `APIKeyStore` 仅存储一条 Key（`apiKey:claude-api`）。CR-001 扩展为按 `providerId` 独立存储：

```typescript
// CR-001: APIKeyStore 扩展接口
interface APIKeyStore {
  /** 按 providerId 存储 Key（加密，使用 safeStorage / OS Keychain） */
  setKey(providerId: 'claude-api' | 'custom', key: string): Promise<void>;

  /** 按 providerId 读取 Key，不存在返回 null */
  getKey(providerId: 'claude-api' | 'custom'): Promise<string | null>;

  /** 按 providerId 删除 Key */
  deleteKey(providerId: 'claude-api' | 'custom'): Promise<void>;
}
```

**存储键名规则**：
- Claude API Key：存储键名 `intentos:apiKey:claude-api`（原有 `intentos:apiKey` 迁移为此格式，兼容读取旧格式）
- Custom API Key：存储键名 `intentos:apiKey:custom`

**原有 `saveApiKey(key)` / `loadApiKey()` 接口**：标记为 `@deprecated`，内部委托给 `setKey('claude-api', key)` / `getKey('claude-api')`，保持向后兼容一个迭代后移除。

---

### 2.4 新增错误码

在 `docs/dev-docs/interfaces.md` § 12.3 M-04 错误码表中追加：

| 错误码 | 含义 | 恢复策略 |
|--------|------|---------|
| `INVALID_BASE_URL` | 自定义 Provider 的 Base URL 格式无效（非合法 URL） | 提示用户检查 Base URL 格式 |
| `MODEL_NOT_FOUND` | 指定模型在端点不存在（HTTP 404） | 提示用户检查模型名称 |
| `CUSTOM_PROVIDER_UNREACHABLE` | 自定义端点无法连接（连接拒绝/超时） | 提示用户确认服务已启动 |
| `TOOL_CALL_UNSUPPORTED` | 模型不支持 function calling（代码生成阶段） | 提示用户更换支持工具调用的模型 |

---

## 3. CustomOpenAIProvider 实现方案

### 3.1 技术选型与依赖

```
新增依赖：openai ^4.x（npm 包）
不引入其他新依赖
```

`openai` npm 包支持 `baseURL` 覆盖，可对接任意 OpenAI Chat Completions 兼容端点：

```typescript
import OpenAI from 'openai';

// 初始化示例
const client = new OpenAI({
  baseURL: config.customBaseUrl,   // 如 'http://localhost:11434/v1'
  apiKey: apiKey ?? 'no-key',      // 空 Key 时传占位字符串，避免 SDK 报错
});
```

### 3.2 CustomOpenAIProvider 类定义

```typescript
// 文件：src/main/modules/ai-provider/custom-openai-provider.ts
export class CustomOpenAIProvider implements AIProvider {
  readonly id = 'custom';
  get name(): string {
    // 从 Base URL 提取域名作为显示名，如 'Custom (api.openai.com)'
    return `Custom (${new URL(this.config.customBaseUrl).hostname})`;
  }

  private client: OpenAI | null = null;
  private config!: CustomProviderConfig;
  private _status: ProviderStatus = { connectionStatus: 'uninitialized' };
  private statusHandlers: Array<(s: ProviderStatus) => void> = [];
  private abortControllers = new Map<string, AbortController>();

  async initialize(config: CustomProviderConfig): Promise<void> {
    this.config = config;
    this._setStatus('initializing');

    // 1. 验证 Base URL 格式
    try { new URL(config.customBaseUrl); }
    catch { throw new ProviderError('INVALID_BASE_URL', `Invalid Base URL: ${config.customBaseUrl}`); }

    // 2. 读取 API Key（可为空）
    const apiKey = await apiKeyStore.getKey('custom');

    // 3. 创建 OpenAI 客户端
    this.client = new OpenAI({
      baseURL: config.customBaseUrl,
      apiKey: apiKey ?? 'intentos-no-key',
    });

    // 4. 发送连接测试请求
    await this._testConnection();
    this._setStatus('ready');
  }

  async dispose(): Promise<void> {
    this._setStatus('disposing');
    for (const ctrl of this.abortControllers.values()) ctrl.abort();
    this.abortControllers.clear();
    this.client = null;
    this._setStatus('uninitialized');
  }
}
```

### 3.3 planApp() — OpenAI Chat Completions 流式实现

**关键适配点**：OpenAI API 使用 `role: 'system' | 'user' | 'assistant'`，内容为字符串；Claude API 使用 Anthropic messages 格式，内容为 `ContentBlock[]`。

```typescript
async *planApp(request: PlanRequest): AsyncIterable<PlanChunk> {
  this._requireReady();
  const controller = new AbortController();
  this.abortControllers.set(request.sessionId, controller);

  const messages = buildOpenAIMessages(request);
  // buildOpenAIMessages: 将 IntentOS PlanRequest 转换为 OpenAI messages 格式
  // system message: 包含 Skill 列表 + 约束（不含 Claude 专有 <thinking> 引导词）
  // user message: 用户意图
  // 多轮历史: contextHistory 直接映射为 role: 'user'|'assistant' 消息

  try {
    const stream = await this.client!.chat.completions.create({
      model: this.config.customPlanModel,
      messages,
      stream: true,
    }, { signal: controller.signal });

    let accumulated = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        accumulated += delta;
        yield {
          sessionId: request.sessionId,
          phase: 'drafting' as const,
          content: delta,
        };
      }
      if (chunk.choices[0]?.finish_reason === 'stop') {
        const planDraft = parsePlanResult(accumulated);
        yield {
          sessionId: request.sessionId,
          phase: 'complete' as const,
          content: '',
          planDraft,
        };
      }
    }
  } catch (err) {
    this._handleStreamError(err, request.sessionId);
  } finally {
    this.abortControllers.delete(request.sessionId);
  }
}
```

**Prompt 适配**（M-05 `buildPlanSystemPrompt` 负责，当 `providerId === 'custom'` 时）：
- 移除 `<thinking>` 标签引导词（Claude 专有）
- 移除 `<parameter name="anthropic_thinking">` 内容块指令
- system message 以纯文本字符串形式传入（非 ContentBlock 格式）

---

### 3.4 generateCode() — OpenAI Function Calling 实现

**关键差异**：Claude 使用 `tool_use` 协议（通过 `@anthropic-ai/claude-agent-sdk`）；OpenAI 使用 `tools` + function calling 格式（`tool_calls` in response）。`CustomOpenAIProvider` 实现独立的工具调用循环，不复用 claude-agent-sdk。

```typescript
async *generateCode(request: GenerateRequest): AsyncIterable<GenProgressChunk> {
  this._requireReady();
  const controller = new AbortController();
  this.abortControllers.set(request.sessionId, controller);

  // 1. 定义代码生成工具集（OpenAI function calling 格式）
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
  ];

  // 2. 构建初始消息（不含 Claude 专有引导词）
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildGenerateSystemPrompt(request.plan, { providerId: 'custom' }) },
    { role: 'user', content: buildGenerateUserPrompt(request) },
  ];

  // 3. 工具调用循环（Agent loop）
  let iteration = 0;
  const maxIterations = 30; // 防止无限循环

  try {
    while (iteration < maxIterations) {
      iteration++;
      const response = await this.client!.chat.completions.create({
        model: this.config.customCodegenModel,
        messages,
        tools,
        tool_choice: 'auto',
      }, { signal: controller.signal });

      const message = response.choices[0].message;
      messages.push(message);

      if (response.choices[0].finish_reason === 'stop') {
        // 无工具调用，生成结束
        break;
      }

      if (response.choices[0].finish_reason === 'tool_calls' && message.tool_calls) {
        // 检测是否支持工具调用（防止模型不支持时静默失败）
        const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

        for (const toolCall of message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await this._executeToolCall(
            toolCall.function.name,
            args,
            request.targetDir,
          );

          // 上报进度
          yield mapToolCallToProgress(toolCall.function.name, args, request.sessionId);

          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
        messages.push(...toolResults);
      }
    }

    yield {
      sessionId: request.sessionId,
      phase: 'done' as const,
      percent: 100,
      message: '应用生成完成',
      appId: request.appId,
      entryPoint: 'main.js',
      outputDir: request.targetDir,
    };
  } catch (err) {
    this._handleStreamError(err, request.sessionId);
  } finally {
    this.abortControllers.delete(request.sessionId);
  }
}
```

**工具调用不支持的检测**：若 `response.choices[0].finish_reason === 'stop'` 且首次迭代未写入任何文件，视为模型未响应工具调用，抛出 `TOOL_CALL_UNSUPPORTED` 错误。

---

### 3.5 executeSkill() 实现

`CustomOpenAIProvider` 的 `executeSkill` 与 `ClaudeAPIProvider` 实现逻辑相同——通过 OpenAI function calling 执行 Skill 方法调用。由于 Skill 执行为单次非流式请求，实现相对简单：

```typescript
async executeSkill(request: SkillCallRequest): Promise<SkillCallResult> {
  this._requireReady();
  const response = await this.client!.chat.completions.create({
    model: this.config.customPlanModel, // Skill 执行使用规划模型（轻量）
    messages: [
      { role: 'system', content: buildSkillExecutePrompt(request) },
      { role: 'user', content: JSON.stringify(request.params) },
    ],
    tools: [buildSkillTool(request.skillId, request.method)],
    tool_choice: { type: 'function', function: { name: request.method } },
  });

  return parseSkillCallResult(response);
}
```

---

### 3.6 连接测试实现（_testConnection）

```typescript
private async _testConnection(): Promise<void> {
  // 发送最小化 completion 请求验证端点可达性和 API Key 有效性
  try {
    await this.client!.chat.completions.create({
      model: this.config.customPlanModel,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) throw new ProviderError('API_KEY_INVALID', 'API Key 无效');
      if (err.status === 404) throw new ProviderError('MODEL_NOT_FOUND', `模型 ${this.config.customPlanModel} 不存在`);
      throw new ProviderError('CUSTOM_PROVIDER_UNREACHABLE', err.message);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new ProviderError('CUSTOM_PROVIDER_UNREACHABLE', `无法连接至 ${this.config.customBaseUrl}`);
    }
    throw err;
  }
}
```

---

### 3.7 流式格式映射

OpenAI SSE 到 IntentOS 内部格式的映射规则：

| OpenAI 流事件 | IntentOS PlanChunk / GenProgressChunk |
|-------------|--------------------------------------|
| `choices[0].delta.content !== null` | `PlanChunk { phase: 'drafting', content: delta }` |
| `choices[0].finish_reason === 'stop'` | `PlanChunk { phase: 'complete', planDraft: parsedResult }` |
| `finish_reason === 'tool_calls'` + `tool_calls[n].function.name === 'write_file'` | `GenProgressChunk { phase: 'codegen', percent: ..., message: 'Writing: path' }` |
| `finish_reason === 'tool_calls'` + `function.name === 'run_command'` + `command.includes('tsc')` | `GenProgressChunk { phase: 'compile', percent: ..., message: 'Compiling...' }` |
| 工具调用循环结束，无更多工具调用 | `GenCompleteChunk { phase: 'done', ... }` |

---

## 4. Prompt 适配规范（M-05 变更）

### 4.1 buildPlanSystemPrompt 变更

```typescript
// M-05 中的 buildPlanSystemPrompt 增加 options 参数
function buildPlanSystemPrompt(
  skills: SkillMeta[],
  options?: { providerId?: string }
): string {
  const isCustomProvider = options?.providerId === 'custom';

  let prompt = buildBaseSkillListSection(skills);
  prompt += buildConstraintsSection();

  if (!isCustomProvider) {
    // 仅 Claude API 时添加思维链引导词
    prompt += `\n\nPlease think step by step using <thinking> tags before providing your response.`;
  }

  return prompt;
}
```

**移除的 Claude 专有内容**（当 `isCustomProvider === true` 时）：
- `<thinking>` 标签引导词
- `<parameter name="anthropic_thinking">` 内容块指令
- 其他 Anthropic 特有格式说明

**保留的通用内容**（两种 Provider 均包含）：
- Skill 列表描述（skills 的 id、name、description、methods）
- SkillApp 代码约束（目录结构、React 18 + TypeScript + Electron 要求）
- 输出格式要求（JSON 规划结果的字段结构）

### 4.2 buildGeneratePrompt 变更

与 `buildPlanSystemPrompt` 同理：新增 `options?.providerId` 参数，`custom` 模式下移除 Claude 专有指令，保留通用代码生成约束。

---

## 5. 新增 IPC Channel 规范

### 5.1 settings:get-custom-provider-config

```typescript
// 请求（渲染进程 → 主进程）
ipcRenderer.invoke('settings:get-custom-provider-config')

// 响应
interface GetCustomProviderConfigResult {
  config: CustomProviderConfig | null;  // null 表示从未配置过
  hasApiKey: boolean;                   // API Key 是否已存储（不返回明文 Key）
}
```

### 5.2 settings:set-custom-provider-config

```typescript
// 请求（渲染进程 → 主进程）
ipcRenderer.invoke('settings:set-custom-provider-config', payload)

interface SetCustomProviderConfigPayload {
  baseUrl: string;          // 必填
  planModel: string;        // 必填
  codegenModel: string;     // 必填
  apiKey?: string;          // 可选，传入时加密存储；不传时保留已有 Key
  clearApiKey?: boolean;    // true 时删除已存储的 Key
}

// 响应
interface SetCustomProviderConfigResult {
  success: boolean;
  error?: { code: string; message: string };  // 校验失败时返回
}
```

**注**：调用 `settings:set-custom-provider-config` 后，若当前激活 Provider 为 `custom`，主进程自动重新调用 `switchProvider` 使新配置生效（热更新配置）。

### 5.3 settings:get-api-key 和 settings:save-api-key 扩展

现有 `settings:get-api-key` 和 `settings:save-api-key` channel 新增 `providerId` 参数：

```typescript
// settings:get-api-key 扩展
ipcRenderer.invoke('settings:get-api-key', { providerId?: 'claude-api' | 'custom' })
// providerId 缺省时默认为 'claude-api'，向后兼容

// settings:save-api-key 扩展
ipcRenderer.invoke('settings:save-api-key', {
  key: string,
  providerId?: 'claude-api' | 'custom'  // 缺省默认 'claude-api'
})
```

### 5.4 ai-provider:set-provider 枚举扩展

```typescript
// 原有 channel 参数扩展
ipcRenderer.invoke('ai-provider:set-provider', {
  providerId: 'claude-api' | 'openclaw' | 'custom',  // 新增 'custom'
  config?: ProviderConfig,
})
```

### 5.5 settings:test-connection 扩展

复用现有 `settings:test-connection` channel，无需新增 channel。主进程处理器读取当前激活 Provider 配置，对 Custom Provider 使用 `CustomOpenAIProvider._testConnection()` 逻辑：

```typescript
// 响应（扩展后）
interface TestConnectionResult {
  success: boolean;
  latencyMs?: number;
  providerName?: string;   // 新增：显示连接的端点名称，如 'api.openai.com'
  error?: { code: string; message: string };
}
```

---

## 6. 与现有技术方案的兼容性

| 技术决策 | 兼容性评估 |
|---------|-----------|
| `AIProvider` 抽象接口不修改 | `CustomOpenAIProvider` 实现同一接口，上层模块零感知 |
| `ClaudeAPIProvider` 不修改 | 现有 Claude 用户无任何行为变化 |
| 请求队列管理器不修改 | `CustomOpenAIProvider` 的请求同样经过队列管理，享有并发控制和排队 UI 逻辑 |
| IPC 转发机制不修改 | `CustomOpenAIProvider` yield 的 `PlanChunk`/`GenProgressChunk` 格式与 Claude 相同，Bridge 转发逻辑不变 |
| 错误码体系扩展（不修改已有） | 新增 4 个错误码（见 § 2.4），不修改现有错误码含义 |
| `@intentos/shared-types` 版本 | `ProviderConfig` 类型变更为联合类型，属于 minor 版本升级（新增联合成员），按 semver 规则升级 `minor` 版本 |

---

## 7. 技术风险与应对方案

| 风险 | 严重程度 | 应对方案 |
|------|---------|---------|
| 目标端点不支持 function calling | High | 在 generateCode 首次迭代后检测，明确提示错误码 `TOOL_CALL_UNSUPPORTED`；UI 层给出"更换支持工具调用的模型"的引导 |
| 不同端点的流式响应格式差异 | Medium | 使用 `openai` npm 包统一处理 SSE 格式；对非标准端点（如 Ollama 的部分版本），依赖 `openai` 包的兼容性层；若出现兼容问题，记录错误日志便于诊断 |
| Prompt 适配不完整导致输出格式异常 | Medium | JSON 规划结果解析使用 try/catch + 降级策略：解析失败时以空规划结果返回，并在 UI 显示"规划结果解析失败，请重试"；生成阶段同理 |
| Base URL 末尾 `/` 处理 | Low | `openai` 包内部规范化 URL，传入时统一 trim 末尾 `/`，避免双斜杠问题 |
| API Key 为空时 openai 包报错 | Low | 传入占位字符串 `'intentos-no-key'`，不影响实际请求；若端点校验 Authorization header 格式则在测试连接时由端点返回 401 |

---

## 8. 文件结构变更

```
src/main/modules/ai-provider/
├── interfaces.ts              # 已有，不修改（AIProvider 接口）
├── claude-api-provider.ts     # 已有，不修改
├── custom-openai-provider.ts  # CR-001 新增
├── api-key-store.ts           # 已有，扩展 getKey/setKey/deleteKey 接口
├── provider-manager.ts        # 已有，switchProvider() 增加 'custom' 分支
└── ai-provider-bridge.ts      # 已有，注册新增 IPC channel 处理器
```

---

## 9. 不需要修改的技术方案

- `docs/spec/ai-provider-spec.md` 第 3 节（通信层架构、IPC 转发机制、请求队列设计）保持不变
- `docs/spec/ai-provider-spec.md` 第 5 节（异常处理策略，超时、取消流程）保持不变
- `docs/spec/ai-provider-spec.md` 第 6 节（OpenClaw Provider 预设计）保持不变
- 所有 Unix Socket JSON-RPC 协议保持不变
- 热更新协议保持不变
- MCP 资源访问代理保持不变
