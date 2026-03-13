# Claude API Stub 开发文档

> **版本**：v1.0 | **日期**：2026-03-13
> **状态**：开发文档，供 executor agent 在 Iteration 1 中实现 `claude-stub/` 时直接使用

---

## 1. Stub 概述

### 1.1 用途与设计目标

**Claude API Stub** 是一个本地 HTTP 服务器，用于 **拦截和模拟 Claude API 请求**。其核心作用是在测试和开发环境中，替代真实的 Anthropic Claude API，提供可控的模拟响应。

**关键特性**：

1. **HTTP 请求拦截**：通过设置环境变量 `ANTHROPIC_BASE_URL=http://localhost:8888`，将 `@anthropic-ai/sdk` 的底层 HTTP 请求重定向到本地 Stub 服务
2. **SSE 流式响应**：完整模拟 Claude API 的 Server-Sent Events（SSE）流式响应格式，支持规划和代码生成的流式数据传输
3. **预设场景**：包含多个预设场景（正常、限流、网络错误、编译错误等），可快速切换以测试不同条件下的应用行为
4. **动态配置**：通过 `POST /stub/config` 和 `POST /stub/scenario` 接口，在运行时动态修改 Stub 行为（延迟、错误率、返回值）

**适用环境**：
- 仅在测试/开发环境使用
- 生产构建完全排除（通过构建配置）
- E2E 测试、Vitest 单元测试、本地开发调试

### 1.2 启动方式

```bash
# 启动 Claude API Stub 服务（监听 http://localhost:8888）
npm run claude-stub

# 或指定端口
STUB_PORT=9999 npm run claude-stub

# 与 IntentOS Desktop 集成启动（开发模式）
npm run dev  # 自动启动 Stub 作为子进程
```

Stub 启动后，环境变量 `ANTHROPIC_BASE_URL=http://localhost:8888` 自动注入到 IntentOS 应用进程，所有 Claude API 请求自动重定向。

---

## 2. 目录结构

Stub 的源代码位于 `claude-stub/` 目录，完整的目录布局如下：

```
claude-stub/
├── src/
│   ├── index.ts              # 服务器入口，Express 应用初始化
│   ├── server.ts             # 核心服务器逻辑
│   ├── routes/
│   │   ├── messages.ts       # POST /v1/messages 端点（主消息接口）
│   │   ├── config.ts         # POST /stub/config 端点（动态配置）
│   │   └── scenario.ts       # POST /stub/scenario 端点（场景切换）
│   ├── scenarios/
│   │   ├── index.ts          # 场景管理器，加载和切换场景
│   │   ├── normal.ts         # 场景：正常响应
│   │   ├── rate-limit-429.ts # 场景：HTTP 429 限流
│   │   ├── network-error.ts  # 场景：网络断开
│   │   ├── compile-error.ts  # 场景：生成含 TypeScript 错误的代码
│   │   └── slow.ts           # 场景：高延迟响应
│   ├── sse/
│   │   └── formatter.ts      # SSE 流式响应格式化工具
│   ├── types.ts              # TypeScript 类型定义
│   └── config.ts             # 全局配置管理
├── package.json
├── tsconfig.json
└── README.md
```

**各文件职责**：

| 文件 | 职责 |
|------|------|
| `src/index.ts` | Express 应用入口，启动 HTTP 服务器，监听 8888 端口 |
| `src/server.ts` | 核心业务逻辑，请求分发和中间件注册 |
| `src/routes/messages.ts` | 实现 `POST /v1/messages` 端点，处理规划/代码生成请求 |
| `src/routes/config.ts` | 实现 `POST /stub/config` 端点，动态修改 Stub 行为参数 |
| `src/routes/scenario.ts` | 实现 `POST /stub/scenario` 端点，切换预设场景 |
| `src/scenarios/*.ts` | 各预设场景的实现（每个文件一个场景） |
| `src/sse/formatter.ts` | 工具函数，将响应数据格式化为 SSE 事件流 |
| `src/types.ts` | TypeScript 类型和接口定义 |
| `src/config.ts` | 全局配置（当前延迟、错误率、场景等）的管理 |

---

## 3. HTTP 端点定义

### 3.1 `POST /v1/messages` — 主消息端点

**用途**：拦截 `@anthropic-ai/sdk` 的消息创建请求，返回 SSE 流式响应。

**请求格式**（Claude API 标准）：

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user",
      "content": "用户的自然语言意图或代码"
    }
  ],
  "system": "系统提示词（包含可用 Skill 列表等）"
}
```

**响应格式**：Server-Sent Events（SSE）流式响应

根据当前场景和请求内容，返回不同的 SSE 事件序列（详见第 5 节）。

**响应 HTTP 头**：

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

**场景响应行为**：

| 场景 | 行为 |
|------|------|
| `normal` | 正常返回完整 SSE 流（规划或代码生成） |
| `rate-limit-429` | 返回 HTTP 429（Too Many Requests） + Retry-After 头 |
| `network-error` | 连接突然断开（返回后立即 socket close） |
| `compile-error` | 生成含 TypeScript 编译错误的代码 |
| `slow` | 每个 SSE 事件之间延迟 MOCK_LATENCY 毫秒 |

---

### 3.2 `POST /stub/config` — 动态配置接口

**用途**：在运行时动态修改 Stub 的行为参数，无需重启服务。

**请求格式**：

```json
{
  "scenario": "normal",
  "latency": 200,
  "errorRate": 0.0,
  "requestTimeout": 30000
}
```

**请求体字段说明**：

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `scenario` | string | 切换到的场景名称（见 4.1 节） | "normal" |
| `latency` | number | SSE 事件间隔延迟（毫秒）；0 表示无延迟 | 200 |
| `errorRate` | number | 错误注入概率（0-1）；0.2 表示 20% 概率返回错误 | 0.0 |
| `requestTimeout` | number | 单个请求超时时间（毫秒） | 30000 |

**响应格式**：

```json
{
  "success": true,
  "message": "配置已更新",
  "config": {
    "scenario": "normal",
    "latency": 200,
    "errorRate": 0.0,
    "requestTimeout": 30000
  }
}
```

**失败响应**（HTTP 400）：

```json
{
  "success": false,
  "error": "无效的场景名称：invalid-scenario"
}
```

---

### 3.3 `POST /stub/scenario` — 场景切换接口

**用途**：快速切换预设场景，是 `config` 接口的简化版本（仅切换场景，保持其他配置不变）。

**请求格式**：

```json
{
  "scenario": "compile-error"
}
```

**响应格式**：

```json
{
  "success": true,
  "message": "已切换到场景：compile-error",
  "scenario": "compile-error"
}
```

---

## 4. 预设场景定义

### 4.1 场景列表与行为

Stub 内置以下预设场景，通过 `/stub/scenario` 或 `/stub/config` 接口切换：

| 场景名称 | 用途 | 行为描述 |
|---------|------|---------|
| `normal` | 正常开发/测试 | 返回完整、合法的规划或生成响应，无延迟、无错误 |
| `rate-limit-429` | 测试 API 限流处理 | 返回 HTTP 429（Too Many Requests），触发指数退避重试逻辑 |
| `network-error` | 测试网络中断处理 | 连接建立后立即断开（模拟网络故障） |
| `compile-error` | 测试编译错误修复循环 | 生成含 TypeScript 编译错误的代码，验证自动修复流程 |
| `slow` | 测试超时和长时间处理 | 每个 SSE 事件间间隔高延迟（由 MOCK_LATENCY 环境变量控制） |

---

### 4.2 场景详细定义

#### 4.2.1 `normal` 场景

**文件**：`src/scenarios/normal.ts`

**行为**：
- 规划请求（识别 system 提示中的"规划"关键词）：返回规划 SSE 流 + 合法 PlanResult JSON
- 生成请求（识别 system 提示中的"生成"关键词）：返回代码生成 SSE 流 + 三段工具调用序列（write_file × 3 → run_command tsc → run_command bundle）

**SSE 事件序列示例**（规划）：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xyz","type":"message","role":"assistant","content":[],"model":"claude-opus-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1024,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"分析用户意图..."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"设计应用布局..."}}

... (多个 content_block_delta 事件)

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\"pages\":[{\"name\":\"MainPage\",\"components\":[...]}]}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2048}}

event: message_stop
data: {"type":"message_stop"}
```

**PlanResult 合法 JSON 格式**（规划的最终结果）：

```json
{
  "pages": [
    {
      "name": "DataCleaningPage",
      "description": "数据清洗主页面",
      "components": [
        {
          "type": "FileUpload",
          "id": "fileInput",
          "label": "选择 CSV 文件",
          "accept": ".csv"
        },
        {
          "type": "Table",
          "id": "dataTable",
          "columns": ["column1", "column2", "column3"],
          "dataBinding": "cleanedData"
        },
        {
          "type": "Button",
          "id": "cleanBtn",
          "label": "开始清洗",
          "action": "callSkill:dataCleaningSkill.clean"
        }
      ]
    }
  ],
  "skillBindings": [
    {
      "skillId": "dataCleaningSkill",
      "methods": ["clean", "export"],
      "permissions": ["fs:read", "fs:write"]
    }
  ],
  "interactions": [
    {
      "trigger": "fileInput.onChange",
      "action": "parseCSV",
      "updateState": "rawData"
    },
    {
      "trigger": "cleanBtn.click",
      "action": "callSkill:dataCleaningSkill.clean",
      "params": { "data": "rawData" },
      "updateState": "cleanedData"
    }
  ]
}
```

#### 4.2.2 `rate-limit-429` 场景

**文件**：`src/scenarios/rate-limit-429.ts`

**行为**：
- 立即返回 HTTP 429（Too Many Requests）
- 包含 `Retry-After` 响应头（建议重试等待秒数）
- 响应体为 Anthropic API 标准错误格式

**HTTP 响应示例**：

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60

{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded. Please retry after 60 seconds."
  }
}
```

**测试目的**：验证 M-04 AI Provider 通信层的指数退避重试逻辑（最多 3 次，间隔 1s/2s/4s）。

#### 4.2.3 `network-error` 场景

**文件**：`src/scenarios/network-error.ts`

**行为**：
- 客户端连接建立后，Stub 立即关闭 Socket（无 graceful shutdown）
- 模拟网络突然中断或路由器故障

**实现方式**：

```typescript
// 在 response.write() 第一个 SSE 事件后，立即调用
response.socket?.destroy();
```

**测试目的**：验证应用处理网络异常断开、SSE 连接突然关闭的恢复逻辑。

#### 4.2.4 `compile-error` 场景

**文件**：`src/scenarios/compile-error.ts`

**行为**：
- 返回代码生成 SSE 流，但生成的代码包含 **故意的 TypeScript 编译错误**
- SSE 流中的 `tool_use` 事件序列：
  1. `write_file`：生成含错误的源代码（如 `const x: number = "string";`）
  2. `run_command` (`tsc`）：返回编译错误信息（如 `error TS2322: Type 'string' is not assignable to type 'number'`）
  3. `run_command` (`tsc`）再次运行，这次编译成功

**SSE 事件序列示例**（代码生成，含错误修复循环）：

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_use_1","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/app/src/MainPage.tsx\",\"content\":\"const badVar: number = \\\"oops\\\";\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_use_2","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"tsc --noEmit\",\"output\":\"error TS2322: Type 'string' is not assignable to type 'number'\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

... (AI 分析错误后修复代码)

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_use_3","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/app/src/MainPage.tsx\",\"content\":\"const goodVar: number = 42;\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

... (再次运行编译，成功)
```

**测试目的**：验证 M-05 SkillApp 生成器的编译错误自动修复循环（触发 AI Provider 的代码修复、重新编译、最终成功）。

#### 4.2.5 `slow` 场景

**文件**：`src/scenarios/slow.ts`

**行为**：
- 返回与 `normal` 场景相同的 SSE 事件，但每个事件之间间隔 `MOCK_LATENCY` 毫秒
- `MOCK_LATENCY` 环境变量控制延迟（默认 5000ms，即 5 秒）

**启动示例**：

```bash
MOCK_LATENCY=10000 npm run claude-stub  # 每个事件间隔 10 秒
```

**SSE 事件发送伪代码**：

```typescript
const latency = process.env.MOCK_LATENCY ? parseInt(process.env.MOCK_LATENCY) : 5000;
for (const event of events) {
  response.write(formatSSEEvent(event));
  await sleep(latency);  // 每个事件后延迟
}
```

**测试目的**：
- 验证超时处理（30 秒超时时，Stub 延迟超过 30s 时应该中止）
- 验证进度条更新和用户交互响应性

---

## 5. SSE 响应格式（完整规范）

### 5.1 SSE 基础格式

SSE（Server-Sent Events）是一种标准的流式传输协议。Stub 使用 Anthropic Claude API 的标准 SSE 事件格式。

**基本格式**（每行以 `\n` 结尾）：

```
event: <event_type>
data: <json_data>

```

**关键点**：
- 每个事件由 `event:` 和 `data:` 行组成
- 事件和数据之间没有空行
- 每个事件末尾有一个空行（两个 `\n`）
- `data` 行的值必须是合法的 JSON

---

### 5.2 规划响应的完整 SSE 事件序列

规划请求返回的 SSE 流包含 5 个事件类型，按此顺序：

```
1. message_start     - 消息创建开始
2. content_block_start  - 文本内容块开始
3. content_block_delta × N  - 文本流式片段（重复多次）
4. content_block_stop   - 文本内容块结束
5. message_delta     - 消息完成信息
6. message_stop      - 消息传输结束
```

**完整示例**（规划场景）：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_1234567890","type":"message","role":"assistant","content":[],"model":"claude-opus-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1024,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"我来分析这个 CSV 数据清洗的需求："}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\n\n1. **应用名称**：CSV 数据清洗工具\n2. **主要功能**：\n   - 上传 CSV 文件\n   - 清洗数据（去重、补缺、验证）\n   - 导出清洗后的数据"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\n\n设计方案如下："}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\n```json\n{\"pages\":[{\"name\":\"MainPage\",\"description\":\"CSV 数据清洗主页\",\"components\":[{\"type\":\"FileUpload\",\"id\":\"csvInput\",\"label\":\"选择 CSV 文件\",\"accept\":\".csv\"},{\"type\":\"DataGrid\",\"id\":\"dataDisplay\",\"columns\":[\"id\",\"name\",\"email\",\"phone\"],\"dataBinding\":\"tableData\"},{\"type\":\"Button\",\"id\":\"cleanBtn\",\"label\":\"开始清洗\",\"action\":\"callSkill:csvCleanerSkill.clean\"}]}],\"skillBindings\":[{\"skillId\":\"csvCleanerSkill\",\"methods\":[\"clean\",\"export\"],\"permissions\":[\"fs:read\",\"fs:write\"]}]}\n```"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":512}}

event: message_stop
data: {"type":"message_stop"}
```

---

### 5.3 代码生成响应的 SSE 事件序列

代码生成请求返回的 SSE 流包含多个 `tool_use` 事件（对应 Agent 的工具调用），以及 `message_start` / `content_block_stop` / `message_stop` 等控制事件。

**完整示例**（代码生成场景，含 3 个 write_file + 1 个 run_command tsc + 1 个 run_command bundle）：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_gen_001","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2048,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/app/src/MainPage.tsx\",\"content\":\"import React from 'react';\\nimport { Button } from '@/components/ui/button';"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\n\\nexport const MainPage: React.FC = () => {\\n  return (\\n    <div className='p-8'>\\n      <h1>CSV 数据清洗工具</h1>\\n      <Button>开始清洗</Button>\\n    </div>\\n  );\\n};"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_2","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/app/src/main.ts\",\"content\":\"import { app, BrowserWindow } from 'electron';\\nimport path from 'path';\\n\\nlet mainWindow: BrowserWindow;\\n\\napp.on('ready', () => {\\n  mainWindow = new BrowserWindow({\\n    width: 1200,\\n    height: 800,\\n    webPreferences: {\\n      preload: path.join(__dirname, 'preload.js')\\n    }\\n  });\\n  mainWindow.loadFile('index.html');\\n});"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool_3","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/app/package.json\",\"content\":\"{\\n  \\\"name\\\": \\\"csv-cleaner\\\",\\n  \\\"version\\\": \\\"1.0.0\\\",\\n  \\\"main\\\": \\\"dist/main.js\\\",\\n  \\\"devDependencies\\\": {\\n    \\\"electron\\\": \\\"^33.0.0\\\",\\n    \\\"typescript\\\": \\\"^5.3.3\\\",\\n    \\\"react\\\": \\\"^18.2.0\\\"\\n  }\\n}\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"tool_4","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"tsc --noEmit\",\"output\":\"Successfully compiled with no errors\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":3}

event: content_block_start
data: {"type":"content_block_start","index":4,"content_block":{"type":"tool_use","id":"tool_5","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"npm run bundle\",\"output\":\"Build complete. Output: /app/dist/csv-cleaner.asar\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":4}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1024}}

event: message_stop
data: {"type":"message_stop"}
```

---

### 5.4 PlanResult 结构（规划的最终 JSON）

规划完成时，最后的 `content_block_delta` 事件包含完整的 JSON 规划结果。此 JSON 必须符合以下结构：

```typescript
interface PlanResult {
  pages: Page[];
  skillBindings: SkillBinding[];
  interactions?: Interaction[];
  styleGuide?: StyleGuide;
}

interface Page {
  name: string;              // 页面标识符，如 "MainPage", "DetailPage"
  description: string;       // 页面用途描述
  components: Component[];   // 页面包含的 UI 组件列表
}

interface Component {
  type: string;              // 组件类型，如 "Button", "Input", "Table", "FileUpload"
  id: string;                // 组件唯一标识（页面内）
  label?: string;            // 显示标签
  description?: string;      // 组件用途
  properties?: Record<string, any>;  // 组件属性（type-specific）
  dataBinding?: string;      // 绑定的数据源名称
  action?: string;           // 点击/触发时的动作（如 "callSkill:skillId.method"）
}

interface SkillBinding {
  skillId: string;           // Skill 的唯一标识
  methods: string[];         // 使用的方法列表，如 ["clean", "export"]
  permissions: string[];     // 所需权限，如 ["fs:read", "fs:write"]
  config?: Record<string, any>;  // Skill 的初始化配置
}

interface Interaction {
  trigger: string;           // 触发条件，如 "button:cleanBtn.click" 或 "fileInput:onChange"
  action: string;            // 执行动作，如 "callSkill:csvCleanerSkill.clean"
  params?: Record<string, any>;  // 传给动作的参数
  updateState?: string;      // 执行后更新的状态名称
}

interface StyleGuide {
  theme?: string;            // "light" | "dark"
  primaryColor?: string;     // 主色调
  typography?: Record<string, any>;  // 字体配置
}
```

**完整 PlanResult 示例**：

```json
{
  "pages": [
    {
      "name": "MainPage",
      "description": "CSV 数据清洗主页面，用于上传和清洗数据",
      "components": [
        {
          "type": "FileUpload",
          "id": "csvInput",
          "label": "选择 CSV 文件",
          "description": "允许用户选择待清洗的 CSV 文件",
          "properties": {
            "accept": ".csv",
            "multiple": false
          },
          "action": "onFileSelect"
        },
        {
          "type": "DataGrid",
          "id": "dataDisplay",
          "description": "显示原始数据和清洗进度",
          "dataBinding": "tableData",
          "properties": {
            "columns": ["id", "name", "email", "phone", "status"],
            "editable": false
          }
        },
        {
          "type": "Button",
          "id": "cleanBtn",
          "label": "开始清洗",
          "description": "触发数据清洗流程",
          "action": "callSkill:csvCleanerSkill.clean",
          "properties": {
            "variant": "primary",
            "disabled": false
          }
        },
        {
          "type": "Button",
          "id": "exportBtn",
          "label": "导出数据",
          "description": "导出清洗后的数据为 CSV 文件",
          "action": "callSkill:csvCleanerSkill.export",
          "properties": {
            "variant": "secondary"
          }
        }
      ]
    },
    {
      "name": "ProgressPage",
      "description": "显示清洗进度和统计信息",
      "components": [
        {
          "type": "ProgressBar",
          "id": "progressBar",
          "description": "显示数据处理进度",
          "dataBinding": "cleaningProgress"
        },
        {
          "type": "Text",
          "id": "statsText",
          "description": "显示处理统计信息",
          "dataBinding": "cleaningStats"
        }
      ]
    }
  ],
  "skillBindings": [
    {
      "skillId": "csvCleanerSkill",
      "methods": ["clean", "export", "preview"],
      "permissions": ["fs:read", "fs:write", "net:http"],
      "config": {
        "delimiter": ",",
        "encoding": "utf-8",
        "skipEmptyRows": true
      }
    }
  ],
  "interactions": [
    {
      "trigger": "csvInput:onChange",
      "action": "parseCSVAndDisplayPreview",
      "params": { "fileInput": "$csvInput.file" },
      "updateState": "tableData"
    },
    {
      "trigger": "cleanBtn:click",
      "action": "callSkill:csvCleanerSkill.clean",
      "params": {
        "data": "$tableData",
        "options": { "removeEmpty": true, "dedup": true }
      },
      "updateState": "cleaningProgress"
    },
    {
      "trigger": "exportBtn:click",
      "action": "callSkill:csvCleanerSkill.export",
      "params": { "data": "$tableData", "format": "csv" },
      "updateState": "exportStatus"
    }
  ],
  "styleGuide": {
    "theme": "light",
    "primaryColor": "#3B82F6",
    "typography": {
      "fontFamily": "system-ui, -apple-system, sans-serif",
      "fontSize": "14px"
    }
  }
}
```

---

## 6. `/stub/config` 接口规范（请求体详解）

### 6.1 完整请求示例

```json
{
  "scenario": "compile-error",
  "latency": 500,
  "errorRate": 0.1,
  "requestTimeout": 45000
}
```

### 6.2 各字段含义与默认值

| 字段 | 类型 | 范围 | 说明 | 默认值 |
|------|------|------|------|--------|
| `scenario` | string | 见 4.1 节场景列表 | 切换到指定预设场景 | "normal" |
| `latency` | number | 0-60000 | SSE 事件间隔延迟（毫秒）；0 表示无延迟 | 200 |
| `errorRate` | number | 0-1 | 错误注入概率；0.2 表示 20% 概率注入错误 | 0.0 |
| `requestTimeout` | number | 1000-300000 | 单个请求的超时时间（毫秒） | 30000 |

### 6.3 配置更新后的行为

配置更新后，Stub 立即对新请求应用新配置。已进行中的请求不受影响。

**示例**：
1. 发起规划请求 A（场景：normal）
2. 发送 `POST /stub/config { "scenario": "slow", "latency": 3000 }`
3. 请求 A 继续执行原场景，请求 B（新请求）采用 slow 场景

---

## 7. 环境变量说明

### 7.1 Stub 自身的环境变量

| 变量名 | 类型 | 说明 | 默认值 |
|--------|------|------|--------|
| `STUB_PORT` | number | Stub 服务器监听的端口 | 8888 |
| `STUB_HOST` | string | Stub 服务器监听的地址 | 127.0.0.1 |
| `MOCK_LATENCY` | number | `slow` 场景的事件间隔延迟（毫秒） | 5000 |
| `MOCK_ERROR_RATE` | number | 全局错误注入概率（0-1） | 0.0 |
| `NODE_ENV` | string | "development" / "production" | "development" |

### 7.2 应用端的环境变量

| 变量名 | 说明 | 生效环境 |
|--------|------|---------|
| `ANTHROPIC_BASE_URL` | Claude API 的基础 URL；设为 `http://localhost:8888` 时，所有请求重定向到 Stub | 开发/测试环境 |
| `ANTHROPIC_API_KEY` | Anthropic API Key；Stub 环境下可设为任意值（Stub 不校验） | 任何环境 |

**启动 Stub 并重定向 SDK 的完整命令**：

```bash
# 终端 1：启动 Stub
npm run claude-stub

# 终端 2：设置环境变量并启动应用
export ANTHROPIC_BASE_URL=http://localhost:8888
export ANTHROPIC_API_KEY=fake-key-for-testing
npm run dev
```

或者在应用的 `.env.local` 文件中配置：

```
ANTHROPIC_BASE_URL=http://localhost:8888
ANTHROPIC_API_KEY=fake-key-for-testing
```

---

## 8. 生产构建排除策略

Stub 代码仅在开发/测试环境使用，**生产构建中必须完全排除**。以下是实现策略：

### 8.1 目录排除

**electron-builder 配置** (`electron-builder.json` 或 `package.json` 中的 `build` 字段)：

```json
{
  "build": {
    "files": [
      "dist/**",
      "public/**",
      "!dist-mock/**",
      "!claude-stub/**"
    ],
    "extraMetadata": {
      "main": "dist/main.js"
    }
  }
}
```

**说明**：
- `!claude-stub/**` — 显式排除 `claude-stub/` 目录及其所有文件
- `!dist-mock/**` — 如果存在 Stub 的构建输出目录，也排除

### 8.2 源代码条件编译

在 `src/main/ai-provider.ts` 或类似的 AI Provider 初始化文件中：

```typescript
// 仅在开发环境启用 Stub
if (process.env.NODE_ENV === "development" && process.env.ANTHROPIC_BASE_URL?.includes("localhost")) {
  // Stub 已在应用启动前由构建脚本启动，这里仅记录日志
  console.log("[DEBUG] Using Claude API Stub at", process.env.ANTHROPIC_BASE_URL);
} else {
  // 生产环境：使用真实 Claude API 端点
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 未配置，无法连接 Claude API");
  }
}
```

### 8.3 Webpack/Vite 条件编译

在 `src/config.ts` 中：

```typescript
export const CLAUDE_STUB_ENABLED =
  process.env.NODE_ENV === "development" &&
  typeof __CLAUDE_STUB__ !== "undefined" &&
  __CLAUDE_STUB__ === true;
```

在 `vite.config.ts` 中：

```typescript
export default {
  define: {
    __CLAUDE_STUB__: process.env.NODE_ENV === "development",
  },
};
```

### 8.4 CI/CD 检查

在构建脚本中添加检查，防止 Stub 代码进入生产包：

```bash
#!/bin/bash
# 检查生产构建是否包含 claude-stub 代码
if unzip -l dist/app-*.asar | grep -q "claude-stub"; then
  echo "ERROR: claude-stub 代码被意外打包！"
  exit 1
fi
echo "✓ Stub 代码成功排除"
```

---

## 9. 测试用法示例

### 9.1 Vitest 单元测试中使用 Stub

**测试文件** (`src/__tests__/ai-provider.test.ts`)：

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import axios from "axios";

describe("Claude API Stub", () => {
  const STUB_URL = "http://localhost:8888";
  let server: any;

  beforeAll(async () => {
    // 启动 Stub（从 claude-stub/dist 启动）
    // 可使用 child_process.spawn() 启动，或在测试套件外手动启动
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // 关闭 Stub
  });

  it("应该返回规划响应", async () => {
    const response = await axios.post(
      `${STUB_URL}/v1/messages`,
      {
        model: "claude-opus-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: "帮我设计一个数据清洗应用" }],
        system: "你是一个应用设计助手",
      },
      {
        responseType: "stream",
      }
    );

    let chunks: string[] = [];
    response.data.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });

    await new Promise((resolve) => response.data.on("end", resolve));

    const fullResponse = chunks.join("");
    expect(fullResponse).toContain("message_start");
    expect(fullResponse).toContain("content_block_delta");
    expect(fullResponse).toContain("message_stop");
  });

  it("应该支持 rate-limit-429 场景", async () => {
    // 切换场景
    await axios.post(`${STUB_URL}/stub/scenario`, {
      scenario: "rate-limit-429",
    });

    try {
      await axios.post(`${STUB_URL}/v1/messages`, {
        model: "claude-opus-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: "任意请求" }],
      });
      expect.fail("应该抛出 429 错误");
    } catch (error: any) {
      expect(error.response?.status).toBe(429);
      expect(error.response?.headers["retry-after"]).toBeDefined();
    }
  });

  it("应该支持动态配置", async () => {
    const response = await axios.post(`${STUB_URL}/stub/config`, {
      scenario: "slow",
      latency: 1000,
      errorRate: 0.1,
    });

    expect(response.data.success).toBe(true);
    expect(response.data.config.latency).toBe(1000);
    expect(response.data.config.errorRate).toBe(0.1);
  });
});
```

### 9.2 E2E 测试中使用 Stub（Playwright + Electron）

**测试文件** (`tests/e2e/generation-flow.spec.ts`)：

```typescript
import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "child_process";

test.describe("SkillApp 生成流程 with Stub", () => {
  let stubProcess: any;
  let electronApp: any;

  test.beforeAll(async () => {
    // 启动 Stub
    stubProcess = spawn("npm", ["run", "claude-stub"], {
      cwd: "./claude-stub",
      env: {
        ...process.env,
        STUB_PORT: "8888",
        MOCK_LATENCY: "500",
      },
    });

    // 等待 Stub 启动
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  test.beforeEach(async () => {
    // 启动 Electron 应用，注入 ANTHROPIC_BASE_URL 环境变量
    electronApp = await electron.launch({
      args: ["dist/main.js"],
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: "http://localhost:8888",
        ANTHROPIC_API_KEY: "test-key",
        NODE_ENV: "test",
      },
    });
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test.afterAll(async () => {
    stubProcess.kill();
  });

  test("应该成功生成 SkillApp（正常场景）", async () => {
    // 切换到 normal 场景
    await fetch("http://localhost:8888/stub/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "normal" }),
    });

    const page = await electronApp.firstWindow();

    // 导航到生成窗口
    await page.click("text=新建应用");

    // 选择 Skill
    await page.click('[data-testid="skill-checkbox-dataCleaningSkill"]');

    // 输入意图
    await page.fill(
      '[data-testid="intent-input"]',
      "创建一个 CSV 数据清洗工具"
    );

    // 点击「开始规划」
    await page.click("text=开始规划");

    // 等待规划完成（最多 30 秒）
    await page.waitForSelector('[data-testid="plan-result"]', {
      timeout: 30000,
    });

    const planText = await page.textContent('[data-testid="plan-result"]');
    expect(planText).toContain("CSV");
    expect(planText).toContain("数据清洗");

    // 点击「生成」按钮
    await page.click("text=确认并生成");

    // 等待生成完成，验证「原地变形」
    await page.waitForSelector('[data-testid="skillapp-main-window"]', {
      timeout: 60000,
    });

    // 验证 SkillApp 已成功启动
    const appTitle = await page.title();
    expect(appTitle).toContain("CSV 数据清洗工具");
  });

  test("应该正确处理编译错误并自动修复", async () => {
    // 切换到 compile-error 场景
    await fetch("http://localhost:8888/stub/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "compile-error" }),
    });

    const page = await electronApp.firstWindow();

    // 开始生成...（同上）
    await page.click("text=新建应用");
    // ... 操作过程同上 ...
    await page.click("text=确认并生成");

    // 等待生成过程中的错误和修复
    // Stub 会生成含错误的代码，然后自动修复并重新编译
    await page.waitForSelector('[data-testid="gen-progress"]');

    // 验证进度条显示「编译修复中」
    let progressText = "";
    for (let i = 0; i < 10; i++) {
      progressText = await page.textContent('[data-testid="gen-progress"]');
      if (progressText?.includes("修复编译错误")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(progressText).toContain("修复编译错误");

    // 最终应该成功
    await page.waitForSelector('[data-testid="skillapp-main-window"]', {
      timeout: 60000,
    });
  });

  test("应该正确处理 Rate Limit（429）", async () => {
    // 切换到 rate-limit-429 场景
    await fetch("http://localhost:8888/stub/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "rate-limit-429" }),
    });

    const page = await electronApp.firstWindow();

    await page.click("text=新建应用");
    // ... 操作过程 ...
    await page.click("text=确认并生成");

    // 等待错误提示
    await page.waitForSelector('[data-testid="error-message"]', {
      timeout: 10000,
    });

    const errorMsg = await page.textContent('[data-testid="error-message"]');
    expect(errorMsg).toContain("API 配额受限");
    expect(errorMsg).toContain("正在重试");

    // 可选：验证重试逻辑已启动
    // Stub 的指数退避重试应该在客户端自动进行
  });
});
```

### 9.3 快速本地测试脚本

**脚本** (`scripts/test-with-stub.sh`)：

```bash
#!/bin/bash
set -e

echo "========== 启动 Claude API Stub =========="
STUB_PORT=8888 npm run claude-stub &
STUB_PID=$!

# 等待 Stub 启动
sleep 2

echo "========== Stub 已启动，PID=$STUB_PID =========="

# 设置环境变量
export ANTHROPIC_BASE_URL=http://localhost:8888
export ANTHROPIC_API_KEY=test-key-do-not-use

echo "========== 运行单元测试 =========="
npm run test:unit

echo "========== 运行 E2E 测试 =========="
npm run test:e2e

echo "========== 清理 =========="
kill $STUB_PID 2>/dev/null || true
wait $STUB_PID 2>/dev/null || true

echo "========== 所有测试完成 =========="
```

**运行方式**：

```bash
bash scripts/test-with-stub.sh
```

---

## 10. 实现检查清单

在 executor agent 实现 `claude-stub/` 时，请按以下清单逐一确认：

- [ ] **服务器基础**
  - [ ] Express.js 服务器创建，监听指定端口
  - [ ] CORS 中间件配置（允许来自任何源的请求）
  - [ ] JSON 请求体解析中间件

- [ ] **路由与端点**
  - [ ] `POST /v1/messages` 实现，接受 Claude API 标准请求格式
  - [ ] `POST /stub/config` 实现，支持动态配置更新
  - [ ] `POST /stub/scenario` 实现，快速切换场景
  - [ ] 404 错误处理

- [ ] **预设场景**
  - [ ] `normal` 场景：规划 SSE 流 + 生成 SSE 流（含 tool_use 事件）
  - [ ] `rate-limit-429` 场景：返回 HTTP 429 + Retry-After 头
  - [ ] `network-error` 场景：连接建立后立即断开
  - [ ] `compile-error` 场景：代码生成 + 编译错误 + 自动修复
  - [ ] `slow` 场景：每个 SSE 事件间隔延迟

- [ ] **SSE 流式响应**
  - [ ] 规划响应流：message_start → content_block_start → content_block_delta × N → content_block_stop → message_delta → message_stop
  - [ ] 代码生成响应流：含 tool_use 事件，每个 tool 对应一个工具调用
  - [ ] PlanResult JSON 生成（合法的规划方案结构）
  - [ ] 所有 SSE 事件正确格式化（`event:\ndata:\n\n`）

- [ ] **环境变量**
  - [ ] `STUB_PORT` 支持
  - [ ] `STUB_HOST` 支持
  - [ ] `MOCK_LATENCY` 支持（控制 slow 场景的延迟）
  - [ ] `MOCK_ERROR_RATE` 支持（全局错误注入）

- [ ] **配置管理**
  - [ ] 全局配置状态（场景、延迟、错误率等）管理
  - [ ] 配置更新时，立即对新请求生效
  - [ ] 已进行中的请求保持原配置

- [ ] **错误处理与日志**
  - [ ] 无效请求体返回 HTTP 400 + 错误信息
  - [ ] 无效场景名称返回 HTTP 400
  - [ ] 控制台输出请求日志（时间戳、方法、URL、响应状态）
  - [ ] SSE 传输中断时正确关闭连接

- [ ] **生产构建排除**
  - [ ] `electron-builder.json` 中配置 `!claude-stub/**`
  - [ ] 源代码中有条件编译检查（仅开发环境启用）
  - [ ] CI 构建脚本检查，防止 Stub 代码进入生产包

- [ ] **测试文件**
  - [ ] 提供 Vitest 单元测试示例
  - [ ] 提供 Playwright E2E 测试示例（含 Electron 集成）
  - [ ] 提供快速测试脚本 (`test-with-stub.sh`)

- [ ] **文档**
  - [ ] `claude-stub/README.md` 编写完毕
  - [ ] 所有环境变量和命令记录在案

---

## 11. 调试技巧

### 11.1 查看 SSE 流内容

使用 `curl` 测试 Stub 响应：

```bash
curl -X POST http://localhost:8888/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-6",
    "max_tokens": 4096,
    "messages": [{"role": "user", "content": "测试"}],
    "system": "你是一个设计助手"
  }'
```

输出应该是 SSE 格式的事件流。

### 11.2 查看当前配置

```bash
# Stub 提供的内部调试端点（可选）
curl http://localhost:8888/stub/status
```

响应示例：

```json
{
  "status": "running",
  "config": {
    "scenario": "normal",
    "latency": 200,
    "errorRate": 0.0,
    "requestTimeout": 30000
  }
}
```

### 11.3 监听 Stub 的控制台输出

```bash
npm run claude-stub 2>&1 | grep -E "(POST|GET|event|error)"
```

### 11.4 NetworkTab 检查（DevTools）

在 Electron DevTools 中打开 Network 标签，筛选 `XHR` 或 `Fetch` 请求，检查：
1. 请求 URL 是否正确重定向到 `localhost:8888`
2. 响应 Content-Type 是否为 `text/event-stream`
3. SSE 数据是否正确流式传输

---

## 12. 常见问题解答

### Q: 为什么 Stub 不能直接替代 Claude API？

**A**: Stub 的目的是模拟，不完全等同于真实 API。Stub 提供的是固定的模拟数据，不能真正理解意图或生成真实代码。在生产环境中必须使用真实的 Claude API。

### Q: 如何测试多个 SkillApp 同时生成？

**A**: M-04 AI Provider 通信层实现了请求队列（最多 1 个并发生成）。可通过 API 同时发送多个规划/生成请求，验证队列排队和 UI 显示"正在排队"提示。

### Q: Stub 能否模拟 OpenClaw Provider？

**A**: 当前的 Stub 仅模拟 Claude API（HTTP SSE 协议）。未来可扩展为支持 WebSocket 协议以模拟 OpenClaw Provider，但当前版本的 MVP 重点在 Claude API。

### Q: 如何修改规划或生成的返回内容？

**A**: 编辑 `src/scenarios/normal.ts` 或相应场景的文件，修改 SSE 事件序列或 PlanResult JSON。重启 Stub 后生效。

### Q: Stub 是否支持 tool_use 事件的真实工具调用？

**A**: 不支持。Stub 返回的 tool_use 事件是模拟的，只是通知客户端有工具调用事件发生。实际的文件操作（write_file、run_command）需要在 M-04 或代理端实现。

---

## 附录 A: 完整 PlanResult 示例（电商应用）

```json
{
  "pages": [
    {
      "name": "ProductListPage",
      "description": "商品列表展示页面，支持搜索、筛选和分页",
      "components": [
        {
          "type": "SearchInput",
          "id": "searchBox",
          "label": "搜索商品",
          "placeholder": "输入商品名称或关键词",
          "dataBinding": "searchQuery",
          "action": "onSearchChange"
        },
        {
          "type": "FilterPanel",
          "id": "filterPanel",
          "description": "商品分类和价格范围筛选",
          "properties": {
            "categories": ["电子产品", "服装", "图书", "食品"],
            "priceRanges": [
              { "min": 0, "max": 100 },
              { "min": 100, "max": 500 },
              { "min": 500, "max": 2000 },
              { "min": 2000, "max": null }
            ]
          },
          "dataBinding": "filters",
          "action": "onFilterChange"
        },
        {
          "type": "ProductGrid",
          "id": "productGrid",
          "description": "商品网格展示（图片、标题、价格）",
          "dataBinding": "productList",
          "properties": {
            "itemsPerPage": 12,
            "columns": 3
          }
        },
        {
          "type": "Pagination",
          "id": "pagination",
          "description": "分页控制",
          "dataBinding": "currentPage",
          "action": "onPageChange"
        }
      ]
    },
    {
      "name": "ProductDetailPage",
      "description": "商品详情页，包括图片、描述、价格、购物车操作",
      "components": [
        {
          "type": "ImageGallery",
          "id": "imageGallery",
          "description": "商品图片轮播",
          "dataBinding": "productImages"
        },
        {
          "type": "Text",
          "id": "productName",
          "label": "商品名称",
          "dataBinding": "product.name"
        },
        {
          "type": "Text",
          "id": "productDescription",
          "label": "商品描述",
          "dataBinding": "product.description"
        },
        {
          "type": "Text",
          "id": "productPrice",
          "label": "价格",
          "dataBinding": "product.price"
        },
        {
          "type": "NumberInput",
          "id": "quantityInput",
          "label": "数量",
          "properties": { "min": 1, "max": 100, "step": 1 },
          "dataBinding": "selectedQuantity"
        },
        {
          "type": "Button",
          "id": "addToCartBtn",
          "label": "加入购物车",
          "action": "callSkill:ecommerceSkill.addToCart",
          "properties": { "variant": "primary" }
        }
      ]
    },
    {
      "name": "CartPage",
      "description": "购物车页面，显示已选商品和结算",
      "components": [
        {
          "type": "CartTable",
          "id": "cartTable",
          "description": "购物车商品列表（商品、数量、单价、小计）",
          "dataBinding": "cartItems",
          "properties": {
            "columns": ["productName", "quantity", "unitPrice", "subtotal", "actions"],
            "editable": true
          }
        },
        {
          "type": "Text",
          "id": "totalPrice",
          "label": "总价",
          "dataBinding": "cartTotal"
        },
        {
          "type": "Button",
          "id": "checkoutBtn",
          "label": "结算",
          "action": "navigateTo:CheckoutPage",
          "properties": { "variant": "primary" }
        },
        {
          "type": "Button",
          "id": "continueShopping",
          "label": "继续购物",
          "action": "navigateTo:ProductListPage",
          "properties": { "variant": "secondary" }
        }
      ]
    }
  ],
  "skillBindings": [
    {
      "skillId": "ecommerceSkill",
      "methods": [
        "searchProducts",
        "getProductDetail",
        "addToCart",
        "updateCart",
        "removeFromCart",
        "checkout",
        "getOrderHistory"
      ],
      "permissions": [
        "fs:read",
        "net:http",
        "data:user-cart",
        "data:user-orders"
      ],
      "config": {
        "apiEndpoint": "https://api.example.com",
        "cacheTimeout": 3600
      }
    }
  ],
  "interactions": [
    {
      "trigger": "searchBox:onChange",
      "action": "callSkill:ecommerceSkill.searchProducts",
      "params": { "query": "$searchBox.value", "filters": "$filters" },
      "updateState": "productList"
    },
    {
      "trigger": "filterPanel:onChange",
      "action": "callSkill:ecommerceSkill.searchProducts",
      "params": { "query": "$searchQuery", "filters": "$filterPanel.value" },
      "updateState": "productList"
    },
    {
      "trigger": "productGrid:onClick",
      "action": "navigateTo:ProductDetailPage",
      "params": { "productId": "$event.productId" },
      "updateState": "selectedProduct"
    },
    {
      "trigger": "pagination:onChange",
      "action": "callSkill:ecommerceSkill.searchProducts",
      "params": { "page": "$pagination.value" },
      "updateState": "productList"
    },
    {
      "trigger": "addToCartBtn:click",
      "action": "callSkill:ecommerceSkill.addToCart",
      "params": {
        "productId": "$selectedProduct.id",
        "quantity": "$quantityInput.value"
      },
      "updateState": "cartItems"
    },
    {
      "trigger": "cartTable:removeItem",
      "action": "callSkill:ecommerceSkill.removeFromCart",
      "params": { "productId": "$event.productId" },
      "updateState": "cartItems"
    },
    {
      "trigger": "cartTable:updateQuantity",
      "action": "callSkill:ecommerceSkill.updateCart",
      "params": {
        "productId": "$event.productId",
        "quantity": "$event.newQuantity"
      },
      "updateState": "cartItems"
    },
    {
      "trigger": "checkoutBtn:click",
      "action": "callSkill:ecommerceSkill.checkout",
      "params": { "cartItems": "$cartItems" },
      "updateState": "orderConfirmation"
    }
  ],
  "styleGuide": {
    "theme": "light",
    "primaryColor": "#FF6B35",
    "secondaryColor": "#004E89",
    "typography": {
      "fontFamily": "PingFang SC, -apple-system, sans-serif",
      "fontSize": "14px",
      "headingFontSize": "24px"
    }
  }
}
```

---

## 附录 B: 完整 `compile-error` 场景的 SSE 流示例

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_gen_002","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-6","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2048,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"我开始生成代码..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_gen_1","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/tmp/skillapp/src/App.tsx\",\"content\":\"import React from 'react';\\nimport { useState } from 'react';\\n\\nconst App: React.FC = () => {\\n  const [count, setCount] = useState<string>(0);  // 错误：number 不能赋给 string\\n  return <div>{count}</div>;\\n};\\n\\nexport default App;\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tool_gen_2","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"tsc --noEmit\",\"output\":\"src/App.tsx:5:39 - error TS2322: Type 'number' is not assignable to type 'string'.\\n\\n5   const [count, setCount] = useState<string>(0);\\n                                              ~\\n\\nFound 1 error.\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"我发现了类型错误。让我修复它..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":3}

event: content_block_start
data: {"type":"content_block_start","index":4,"content_block":{"type":"tool_use","id":"tool_gen_3","name":"write_file"}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/tmp/skillapp/src/App.tsx\",\"content\":\"import React from 'react';\\nimport { useState } from 'react';\\n\\nconst App: React.FC = () => {\\n  const [count, setCount] = useState<number>(0);  // 修复：改为 number\\n  return <div>{count}</div>;\\n};\\n\\nexport default App;\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":4,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":4}

event: content_block_start
data: {"type":"content_block_start","index":5,"content_block":{"type":"tool_use","id":"tool_gen_4","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":5,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"tsc --noEmit\",\"output\":\"Successfully compiled with no errors\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":5,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":5}

event: content_block_start
data: {"type":"content_block_start","index":6,"content_block":{"type":"tool_use","id":"tool_gen_5","name":"run_command"}}

event: content_block_delta
data: {"type":"content_block_delta","index":6,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"npm run bundle\",\"output\":\"Build complete. Output: /tmp/skillapp/dist/app.asar\"}"}}

event: content_block_delta
data: {"type":"content_block_delta","index":6,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_stop
data: {"type":"content_block_stop","index":6}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1024}}

event: message_stop
data: {"type":"message_stop"}
```

---

**文档编写完毕。此文档提供了 Claude API Stub 的完整设计规范，executor agent 可直接按此规范实现。**
