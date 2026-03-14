# IntentOS Desktop IPC 通信通道规范

> **版本**：v1.0 | **日期**：2026-03-13 | **状态**：正式文档
> **适用场景**：Iter 2 主进程 IPC Hub 和 preload contextBridge 实现

---

## 目录

1. [架构概述](#架构概述)
2. [全部 IPC 通道清单](#全部-ipc-通道清单)
3. [每个通道的完整定义](#每个通道的完整定义)
4. [contextBridge 暴露结构](#contextbridge-暴露结构)
5. [流式通道的特殊处理](#流式通道的特殊处理)
6. [IPC Hub 注册规范（主进程侧）](#ipc-hub-注册规范主进程侧)
7. [错误传递规范](#错误传递规范)

---

## 架构概述

### Electron 三进程模型中 IPC 的角色

IntentOS Desktop 采用 **Electron 进程隔离架构**：

```
┌─────────────────────────────────────────┐
│  Desktop 主进程 (Electron Main)         │
│  ├── IPC Hub (ipcMain 注册中心)        │
│  ├── M-02 Skill 管理器                 │
│  ├── M-03 SkillApp 生命周期管理器      │
│  ├── M-04 AI Provider 通信层           │
│  ├── M-05 SkillApp 生成器              │
│  └── Unix Socket Server (Desktop↔SkillApp)
└─────────┬───────────────────────────────┘
          │ contextBridge IPC
          │ (ipcRenderer ←→ ipcMain)
          ▼
┌─────────────────────────────────────────┐
│  Desktop 渲染进程 (Renderer)             │
│  ├── preload.ts (contextBridge API)    │
│  ├── Skill 管理中心 UI                  │
│  ├── SkillApp 管理中心 UI               │
│  ├── 应用生成窗口 UI                    │
│  └── 设置页面 UI                        │
└─────────────────────────────────────────┘
```

**IPC 的三大职责**：

1. **渲染进程 → 主进程的请求**：UI 事件驱动的功能调用（如「启动 SkillApp」）
2. **主进程 → 渲染进程的推送**：事件通知和流式数据转发（如「Skill 变更」、「生成进度」）
3. **流式数据转发**：Claude API SSE 流通过主进程中转到生成窗口（sessionId 隔离）

### contextBridge 安全模型说明

采用 **contextBridge 显式 API 暴露** 模式（非 remote 模块）：

- **主进程**：通过 `ipcMain.handle()` 和 `ipcMain.on()` 注册所有 channel handler
- **preload 脚本**：通过 `contextBridge.exposeInMainWorld('intentOS', {...})` 暴露白名单 API
- **渲染进程**：只能调用 `window.intentOS.*` 中显式暴露的方法，无法直接访问 Node.js API
- **安全边界**：XSS 漏洞即使出现在渲染进程，也无法通过 IPC 突破到主进程的 Node.js 权限

### IPC 通道命名规范

**格式**：`domain:action[:optional-suffix]`

- **domain**：功能域（如 `skill`, `app`, `generation`, `ai-provider`, `settings`, `modification`）
- **action**：具体动作（如 `list`, `register`, `launch`, `start-plan`）
- **optional-suffix**：可选后缀，用于识别特定会话或事件流（如 `:sessionId` 用于动态 channel）

**示例**：
- `skill:list` — 获取 Skill 列表（同步请求-响应）
- `app:launch` — 启动 SkillApp（同步请求-响应）
- `generation:start-plan` — 启动规划会话（异步，返回 sessionId）
- `ai-provider:plan-chunk:{sessionId}` — 规划流式 chunk（动态 channel，sessionId 隔离）
- `skill-manager:changed` — Skill 变更事件推送（事件）

---

## 全部 IPC 通道清单

### Skill 管理域（`skill:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `skill:list` | → 单向请求 | `ipcRenderer.invoke()` | 获取所有已安装 Skill 列表 |
| `skill:get` | → 单向请求 | `ipcRenderer.invoke()` | 获取单个 Skill 详情 |
| `skill:register` | → 单向请求 | `ipcRenderer.invoke()` | 注册本地 Skill（扫描路径） |
| `skill:unregister` | → 单向请求 | `ipcRenderer.invoke()` | 卸载 Skill（检查引用后执行） |
| `skill:check-dependencies` | → 单向请求 | `ipcRenderer.invoke()` | 检查 Skill 依赖是否满足 |
| `skill:get-ref-count` | → 单向请求 | `ipcRenderer.invoke()` | 获取 Skill 被引用次数 |
| `skill-manager:changed` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | Skill 变更事件（新增/移除/更新） |

### SkillApp 生命周期域（`app:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `app:list` | → 单向请求 | `ipcRenderer.invoke()` | 获取所有 SkillApp 列表 |
| `app:get-status` | → 单向请求 | `ipcRenderer.invoke()` | 获取单个 SkillApp 运行状态 |
| `app:launch` | → 单向请求 | `ipcRenderer.invoke()` | 启动 SkillApp |
| `app:stop` | → 单向请求 | `ipcRenderer.invoke()` | 停止 SkillApp |
| `app:restart` | → 单向请求 | `ipcRenderer.invoke()` | 重启 SkillApp |
| `app:focus-window` | → 单向请求 | `ipcRenderer.invoke()` | 聚焦 SkillApp 窗口 |
| `app:uninstall` | → 单向请求 | `ipcRenderer.invoke()` | 卸载 SkillApp（清理文件） |
| `app-lifecycle:status-changed` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | SkillApp 状态变更事件 |

### 应用生成域（`generation:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `generation:start-plan` | → 单向请求 | `ipcRenderer.invoke()` | 启动规划会话，返回 sessionId |
| `generation:refine-plan` | → 单向请求 | `ipcRenderer.invoke()` | 多轮交互调整规划方案 |
| `generation:confirm-generate` | → 单向请求 | `ipcRenderer.invoke()` | 确认方案并开始代码生成 |
| `generation:start-modify` | → 单向请求 | `ipcRenderer.invoke()` | 启动增量修改会话 |
| `generation:confirm-apply-modify` | → 单向请求 | `ipcRenderer.invoke()` | 确认增量方案并应用 |
| `generation:cancel` | → 单向请求 | `ipcRenderer.invoke()` | 取消当前生成/修改会话 |
| `generation:plan-update:{sessionId}` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | 规划方案更新（流式或批量） |
| `generation:build-progress:{sessionId}` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | 生成进度推送（代码生成/编译/打包三段） |
| `generation:transform-ready` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | 原地变形就绪信号 |
| `generation:error:{sessionId}` | ← 事件推送 | `ipcMain.on()` + `webContents.send()` | 生成失败错误信息 |

### AI Provider 域（`ai-provider:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `ai-provider:plan` | → 单向请求 | `ipcRenderer.invoke()` | 发起规划请求（由 M-05 生成器转发） |
| `ai-provider:generate` | → 单向请求 | `ipcRenderer.invoke()` | 发起代码生成请求（由 M-05 生成器转发） |
| `ai-provider:skill-call` | → 单向请求 | `ipcRenderer.invoke()` | 触发 Skill 执行（由 SkillApp Runtime 转发） |
| `ai-provider:cancel` | → 单向请求 | `ipcRenderer.invoke()` | 取消指定 sessionId 的会话 |
| `ai-provider:status` | → 单向请求 | `ipcRenderer.invoke()` | 查询当前 Provider 连接状态 |
| `ai-provider:plan-chunk:{sessionId}` | ← 事件推送 | `webContents.send()` | 规划流式 chunk（PlanChunk） |
| `ai-provider:plan-complete:{sessionId}` | ← 事件推送 | `webContents.send()` | 规划完成信号 |
| `ai-provider:plan-error:{sessionId}` | ← 事件推送 | `webContents.send()` | 规划错误信息 |
| `ai-provider:gen-progress:{sessionId}` | ← 事件推送 | `webContents.send()` | 生成进度 chunk（GenProgressChunk） |
| `ai-provider:gen-complete:{sessionId}` | ← 事件推送 | `webContents.send()` | 生成完成信号 |
| `ai-provider:gen-error:{sessionId}` | ← 事件推送 | `webContents.send()` | 生成错误信息 |
| `ai-provider:status-changed` | ← 事件推送 | `webContents.send()` | Provider 状态变化通知（全局广播） |

### 设置域（`settings:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `settings:get` | → 单向请求 | `ipcRenderer.invoke()` | 获取设置项值 |
| `settings:set` | → 单向请求 | `ipcRenderer.invoke()` | 更新设置项值 |
| `settings:get-provider-config` | → 单向请求 | `ipcRenderer.invoke()` | 获取 AI Provider 配置 |
| `settings:set-provider-config` | → 单向请求 | `ipcRenderer.invoke()` | 更新 AI Provider 配置 |
| `settings:get-api-key` | → 单向请求 | `ipcRenderer.invoke()` | 获取指定 Provider 的 API Key（masked），支持 `providerId` 参数（默认 `'claude-api'`） |
| `settings:save-api-key` | → 单向请求 | `ipcRenderer.invoke()` | 保存 API Key（加密存储），支持 `providerId` 参数（默认 `'claude-api'`） |
| `settings:delete-api-key` | → 单向请求 | `ipcRenderer.invoke()` | 删除 API Key |
| `settings:test-connection` | → 单向请求 | `ipcRenderer.invoke()` | 测试 AI Provider 连接，响应新增 `providerName` 字段 |
| `settings:connection-status-changed` | ← 事件推送 | `webContents.send()` | 连接状态变更通知 |
| `settings:get-custom-provider-config` | → 单向请求 | `ipcRenderer.invoke()` | 读取自定义 Provider 配置（Base URL、模型名），不含 API Key 明文（CR-001 新增） |
| `settings:set-custom-provider-config` | → 单向请求 | `ipcRenderer.invoke()` | 写入自定义 Provider 配置，可选传入 API Key 加密存储（CR-001 新增） |

### 修改域（`modification:*`）

| Channel 名称 | 方向 | 触发方式 | 说明 |
|------------|------|---------|------|
| `modification:start` | → 单向请求 | `ipcRenderer.invoke()` | 启动增量修改会话 |
| `modification:confirm` | → 单向请求 | `ipcRenderer.invoke()` | 确认增量修改 |
| `modification:cancel` | → 单向请求 | `ipcRenderer.invoke()` | 取消修改会话 |
| `modification:plan-chunk:{sessionId}` | ← 事件推送 | `webContents.send()` | 增量修改规划流式 chunk |
| `modification:progress:{sessionId}` | ← 事件推送 | `webContents.send()` | 修改进度推送 |
| `modification:error:{sessionId}` | ← 事件推送 | `webContents.send()` | 修改失败错误信息 |

---

## 每个通道的完整定义

### Skill 管理域

#### `skill:list` — 获取所有已安装 Skill 列表

**请求**：
```typescript
interface SkillListRequest {
  // 无参数
}
```

**响应**：
```typescript
interface SkillListResponse {
  skills: SkillMeta[];
  totalCount: number;
}

interface SkillMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: Permission[];
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  refCount: number;  // 被 SkillApp 引用次数
}

type Permission = "fs:read" | "fs:write" | "net:http" | "process:spawn" | string;
```

**错误情况**：
```typescript
interface SkillListError {
  code: "SKILL_SCAN_FAILED" | "PERMISSION_DENIED";
  message: string;
}
```

**Channel 注册**（主进程）：
```typescript
ipcMain.handle('skill:list', async () => {
  return await skillManager.getInstalledSkills();
});
```

---

#### `skill:get` — 获取单个 Skill 详情

**请求**：
```typescript
interface SkillGetRequest {
  skillId: string;
}
```

**响应**：
```typescript
interface SkillDetail extends SkillMeta {
  readme: string;           // Markdown 格式的文档
  signature?: string;       // 代码签名（可选）
  dependencies: string[];   // 依赖的其他 Skill ID 列表
}
```

**错误情况**：
```typescript
interface SkillGetError {
  code: "SKILL_NOT_FOUND" | "SKILL_CORRUPTED";
  message: string;
}
```

---

#### `skill:register` — 注册本地 Skill

**请求**：
```typescript
interface SkillRegisterRequest {
  dirPath: string;  // 本地 Skill 目录路径
}
```

**响应**：
```typescript
interface SkillRegisterResponse {
  skillId: string;
  meta: SkillMeta;
}
```

**错误情况**：
```typescript
interface SkillRegisterError {
  code: "INVALID_SKILL_DIR" | "MANIFEST_NOT_FOUND" | "SKILL_ALREADY_EXISTS" | "PERMISSION_DENIED";
  message: string;
}
```

---

#### `skill:unregister` — 卸载 Skill

**请求**：
```typescript
interface SkillUnregisterRequest {
  skillId: string;
}
```

**响应**：
```typescript
interface SkillUnregisterResponse {
  success: boolean;
  blockedBy?: string[];  // 正在使用此 Skill 的 SkillApp ID 列表（若无法卸载）
}
```

**错误情况**：
```typescript
interface SkillUnregisterError {
  code: "SKILL_NOT_FOUND" | "SKILL_IN_USE" | "PERMISSION_DENIED";
  message: string;
  blockedBy?: string[];
}
```

---

#### `skill:check-dependencies` — 检查 Skill 依赖

**请求**：
```typescript
interface SkillCheckDependenciesRequest {
  skillId: string;
}
```

**响应**：
```typescript
interface DependencyCheckResult {
  allSatisfied: boolean;
  missing: string[];        // 缺失的依赖 Skill ID
  incompatible: Array<{     // 版本不兼容
    skillId: string;
    required: string;       // 需要的版本范围
    installed: string;      // 实际安装版本
  }>;
}
```

---

#### `skill:get-ref-count` — 获取 Skill 被引用次数

**请求**：
```typescript
interface SkillRefCountRequest {
  skillId: string;
}
```

**响应**：
```typescript
interface SkillRefCountResponse {
  refCount: number;
  referencedBy: string[];  // 引用此 Skill 的 SkillApp ID 列表
}
```

---

#### `skill-manager:changed` — Skill 变更事件（事件推送）

**事件数据**：
```typescript
interface SkillChangedEvent {
  type: "added" | "removed" | "updated";
  skillId: string;
  meta: SkillMeta;
  timestamp: string;  // ISO 8601
}
```

**preload 监听方式**：
```typescript
contextBridge.exposeInMainWorld('intentOS', {
  skill: {
    onChanged: (callback: (event: SkillChangedEvent) => void): (() => void) => {
      const handler = (_: IpcRendererEvent, event: SkillChangedEvent) => callback(event);
      ipcRenderer.on('skill-manager:changed', handler);
      return () => ipcRenderer.removeListener('skill-manager:changed', handler);
    },
  },
});
```

---

### SkillApp 生命周期域

#### `app:list` — 获取所有 SkillApp 列表

**请求**：
```typescript
interface AppListRequest {
  // 无参数
}
```

**响应**：
```typescript
interface AppListResponse {
  apps: AppRegistryEntry[];
  totalCount: number;
}

interface AppRegistryEntry {
  appId: string;
  name: string;
  skillIds: string[];
  status: AppStatus;
  createdAt: string;    // ISO 8601
  updatedAt: string;
  appPath: string;
  version: number;      // 修改次数
}

type AppStatus = "registered" | "starting" | "running" | "stopped" | "crashed" | "uninstalled";
```

---

#### `app:get-status` — 获取 SkillApp 运行状态

**请求**：
```typescript
interface AppGetStatusRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppStatusResponse {
  appId: string;
  status: AppStatus;
  pid?: number;              // 进程 ID（running 时）
  memoryUsageMB?: number;    // 内存占用（running 时）
  cpuPercent?: number;       // CPU 占用百分比
  lastActiveAt?: string;     // 最后活跃时间戳
}
```

---

#### `app:launch` — 启动 SkillApp

**请求**：
```typescript
interface AppLaunchRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppLaunchResponse {
  success: boolean;
  pid?: number;
}
```

**错误情况**：
```typescript
interface AppLaunchError {
  code: "APP_NOT_FOUND" | "APP_ALREADY_RUNNING" | "SPAWN_FAILED" | "CORRUPTED_APP";
  message: string;
}
```

---

#### `app:stop` — 停止 SkillApp

**请求**：
```typescript
interface AppStopRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppStopResponse {
  success: boolean;
}
```

---

#### `app:restart` — 重启 SkillApp

**请求**：
```typescript
interface AppRestartRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppRestartResponse {
  success: boolean;
  pid?: number;
}
```

---

#### `app:focus-window` — 聚焦 SkillApp 窗口

**请求**：
```typescript
interface AppFocusRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppFocusResponse {
  success: boolean;
}
```

---

#### `app:uninstall` — 卸载 SkillApp

**请求**：
```typescript
interface AppUninstallRequest {
  appId: string;
}
```

**响应**：
```typescript
interface AppUninstallResponse {
  success: boolean;
}
```

**错误情况**：
```typescript
interface AppUninstallError {
  code: "APP_NOT_FOUND" | "APP_STILL_RUNNING" | "PERMISSION_DENIED";
  message: string;
}
```

---

#### `app-lifecycle:status-changed` — SkillApp 状态变更事件

**事件数据**：
```typescript
interface AppStatusChangedEvent {
  appId: string;
  oldStatus: AppStatus;
  newStatus: AppStatus;
  timestamp: string;
  pid?: number;
  error?: { code: string; message: string };
}
```

---

### 应用生成域

#### `generation:start-plan` — 启动规划会话

**请求**：
```typescript
interface GenerationStartPlanRequest {
  sessionId: string;           // 由调用方生成的 UUID
  skillIds: string[];          // 选中的 Skill ID 列表
  intent: string;              // 用户自然语言描述
}
```

**响应**：
```typescript
interface GenerationStartPlanResponse {
  sessionId: string;           // 确认的会话 ID
  status: "streaming";         // 规划流已启动
}
```

**说明**：M-05 生成器通过此 channel 发起 `ai-provider:plan` 请求，主进程 IPC Hub 路由到 M-04，M-04 将 Claude API SSE 流通过 `ai-provider:plan-chunk:{sessionId}` 转发回渲染进程。

---

#### `generation:refine-plan` — 多轮交互调整规划

**请求**：
```typescript
interface GenerationRefinePlanRequest {
  sessionId: string;
  feedback: string;            // 用户反馈或调整意见
}
```

**响应**：
```typescript
interface GenerationRefinePlanResponse {
  status: "streaming";
}
```

---

#### `generation:confirm-generate` — 确认方案并开始生成

**请求**：
```typescript
interface GenerationConfirmGenerateRequest {
  sessionId: string;
  appName?: string;            // 应用名称（可选，若规划阶段未确定）
}
```

**响应**：
```typescript
interface GenerationConfirmGenerateResponse {
  appId: string;               // 生成的应用 ID
  status: "code-generating";   // 开始代码生成
}
```

---

#### `generation:start-modify` — 启动增量修改会话

**请求**：
```typescript
interface GenerationStartModifyRequest {
  sessionId: string;
  appId: string;               // 要修改的 SkillApp ID
  requirement: string;         // 修改需求描述
  newSkillIds?: string[];      // 要新增的 Skill ID（可选）
}
```

**响应**：
```typescript
interface GenerationStartModifyResponse {
  sessionId: string;
  status: "streaming";
}
```

---

#### `generation:confirm-apply-modify` — 确认增量修改

**请求**：
```typescript
interface GenerationConfirmApplyModifyRequest {
  sessionId: string;
}
```

**响应**：
```typescript
interface GenerationConfirmApplyModifyResponse {
  appId: string;
  status: "hot-updating";
}
```

---

#### `generation:cancel` — 取消生成/修改会话

**请求**：
```typescript
interface GenerationCancelRequest {
  sessionId: string;
}
```

**响应**：
```typescript
interface GenerationCancelResponse {
  success: boolean;
}
```

---

#### 流式事件：`generation:plan-update:{sessionId}`、`generation:build-progress:{sessionId}` 等

这些通道由主进程主动推送数据到渲染进程。详见[流式通道的特殊处理](#流式通道的特殊处理)一节。

---

### AI Provider 域

#### `ai-provider:plan` — 发起规划请求

**请求**：
```typescript
interface AIPlanRequest {
  sessionId: string;
  intent: string;
  skillIds: string[];
  contextHistory?: Array<{     // 多轮对话历史
    role: "user" | "assistant";
    content: string;
  }>;
}
```

**响应**：
```typescript
interface AIPlanResponse {
  sessionId: string;
  status: "streaming";
}
```

**说明**：此 channel 由 M-05 生成器调用，主进程 IPC Hub 转发至 M-04 AI Provider 通信层。M-04 通过 `ai-provider:plan-chunk:{sessionId}` 返回流式数据。

---

#### `ai-provider:generate` — 发起代码生成请求

**请求**：
```typescript
interface AIGenerateRequest {
  sessionId: string;
  appId: string;
  plan: PlanResult;            // 规划阶段的输出
  targetDir: string;           // 生成代码输出目录
  mode: "full" | "incremental"; // 完整生成或增量生成
}

interface PlanResult {
  appName: string;
  pages: PageDesign[];
  skillMapping: Record<string, string>;
  permissions: Permission[];
}

interface PageDesign {
  name: string;
  layout: string;              // 布局描述
  components: Array<{
    type: string;
    props: Record<string, any>;
  }>;
}
```

**响应**：
```typescript
interface AIGenerateResponse {
  sessionId: string;
  status: "code-generating";   // 代码生成中
}
```

---

#### `ai-provider:skill-call` — 触发 Skill 执行

**请求**：
```typescript
interface SkillCallRequest {
  sessionId: string;
  skillId: string;
  method: string;
  params: Record<string, any>;
  callerAppId: string;         // 调用此 Skill 的 SkillApp ID
}
```

**响应**：
```typescript
interface SkillCallResult {
  success: boolean;
  result?: any;
  error?: { code: string; message: string };
}
```

---

#### `ai-provider:cancel` — 取消会话

**请求**：
```typescript
interface AICancelRequest {
  sessionId: string;
}
```

**响应**：
```typescript
interface AICancelResponse {
  success: boolean;
}
```

---

#### `ai-provider:status` — 查询 Provider 状态

**请求**：
```typescript
interface AIStatusRequest {
  // 无参数
}
```

**响应**：
```typescript
interface ProviderStatus {
  providerId: "claude-api" | "openclaw";
  status: "uninitialized" | "initializing" | "ready" | "error" | "rate_limited" | "disposing";
  errorCode?: string;          // 错误码（若 status = "error"）
  errorMessage?: string;
  latencyMs?: number;          // 最后一次请求延迟
  modelsAvailable?: string[]; // 可用模型列表
}
```

---

#### 流式事件：`ai-provider:plan-chunk:{sessionId}` 等

主进程将 Claude API SSE 流通过这些动态 channel 转发到渲染进程。详见[流式通道的特殊处理](#流式通道的特殊处理)一节。

---

### 设置域

#### `settings:get` — 获取设置项

**请求**：
```typescript
interface SettingsGetRequest {
  key: string;  // 设置项 key（如 "theme", "language", "autoUpdate"）
}
```

**响应**：
```typescript
interface SettingsGetResponse {
  value: any;
}
```

---

#### `settings:set` — 更新设置项

**请求**：
```typescript
interface SettingsSetRequest {
  key: string;
  value: any;
}
```

**响应**：
```typescript
interface SettingsSetResponse {
  success: boolean;
}
```

---

#### `settings:get-provider-config` — 获取 AI Provider 配置

**请求**：
```typescript
interface SettingsGetProviderConfigRequest {
  // 无参数
}
```

**响应**：
```typescript
interface ProviderConfig {
  providerId: "claude-api" | "openclaw";
  claudeModel?: string;        // Claude 规划用模型
  claudeCodegenModel?: string; // Claude 代码生成用模型
  openclawHost?: string;
  openclawPort?: number;
}
```

---

#### `settings:set-provider-config` — 更新 AI Provider 配置

**请求**：
```typescript
interface SettingsSetProviderConfigRequest {
  providerId: "claude-api" | "openclaw";
  config: Partial<ProviderConfig>;
}
```

**响应**：
```typescript
interface SettingsSetProviderConfigResponse {
  success: boolean;
}
```

---

#### `settings:get-api-key` — 获取 API Key（Masked）

**请求**：
```typescript
interface SettingsGetApiKeyRequest {
  // 无参数
}
```

**响应**：
```typescript
interface SettingsGetApiKeyResponse {
  key: string | null;    // null 表示未配置；若已配置则返回 masked 字符串如 "sk-****...4c5d"
  configured: boolean;
}
```

---

#### `settings:save-api-key` — 保存 API Key

**请求**：
```typescript
interface SettingsSaveApiKeyRequest {
  key: string;  // 原始明文 API Key
}
```

**响应**：
```typescript
interface SettingsSaveApiKeyResponse {
  success: boolean;
}
```

**说明**：主进程接收 API Key 后立即加密存储（使用 `safeStorage.encryptString()`），不在内存中持久化。

---

#### `settings:delete-api-key` — 删除 API Key

**请求**：
```typescript
interface SettingsDeleteApiKeyRequest {
  // 无参数
}
```

**响应**：
```typescript
interface SettingsDeleteApiKeyResponse {
  success: boolean;
}
```

---

#### `settings:test-connection` — 测试 AI Provider 连接

**请求**：
```typescript
interface SettingsTestConnectionRequest {
  // 无参数，使用当前配置和 API Key 测试
}
```

**响应**：
```typescript
interface SettingsTestConnectionResponse {
  success: boolean;
  latencyMs?: number;
  modelsAvailable?: string[];
  error?: { code: string; message: string };
}
```

---

#### `settings:connection-status-changed` — 连接状态变更事件

**事件数据**：
```typescript
interface ConnectionStatusChangedEvent {
  providerId: string;
  status: "connected" | "disconnected" | "connecting" | "error";
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}
```

---

#### `settings:get-custom-provider-config` — 获取自定义 Provider 配置 <!-- CR-001 新增 -->

**方向**：Renderer → Main（invoke）

**请求**：无参数（`undefined`）

**响应**：
```typescript
interface GetCustomProviderConfigResponse {
  baseURL: string;      // 当前保存的 Base URL，未配置时为空字符串
  model: string;        // 当前保存的模型名称，未配置时为空字符串
  providerName: string; // 当前保存的 Provider 名称，未配置时为空字符串
}
```

**说明**：
- 返回 `ProviderConfig` 中 `custom` 分支的非敏感字段（不含 API Key）
- API Key 通过 `settings:get-api-key` 单独获取（`providerId: 'custom'`）
- 未配置时所有字段返回空字符串，不抛出错误

**错误**：
| 错误码 | 触发条件 |
|--------|----------|
| （无） | 此接口设计为不抛出错误 |

---

#### `settings:set-custom-provider-config` — 保存自定义 Provider 配置 <!-- CR-001 新增 -->

**方向**：Renderer → Main（invoke）

**请求**：
```typescript
interface SetCustomProviderConfigRequest {
  baseURL: string;      // OpenAI-compatible 端点 Base URL，必填
  model: string;        // 目标模型名称，必填
  providerName: string; // 用户自定义名称，必填
}
```

**响应**：
```typescript
interface SetCustomProviderConfigResponse {
  success: boolean;
  error?: { code: string; message: string };
}
```

**说明**：
- 持久化 `custom` 分支的非敏感配置字段到 electron-store
- API Key 通过 `settings:save-api-key` 单独保存（`providerId: 'custom'`）
- `baseURL` 必须为合法 URL（以 `http://` 或 `https://` 开头），否则返回 `INVALID_BASE_URL` 错误
- 保存成功后不自动切换 Provider，需用户再调用 `ai-provider:set-provider`

**错误**：
| 错误码 | 触发条件 |
|--------|----------|
| `INVALID_BASE_URL` | `baseURL` 格式不合法（非 http/https URL） |
| `STORE_WRITE_FAILED` | electron-store 写入失败 |

---

### 修改域

#### `modification:start` — 启动增量修改会话

**请求**：
```typescript
interface ModificationStartRequest {
  sessionId: string;
  appId: string;
  requirement: string;
}
```

**响应**：
```typescript
interface ModificationStartResponse {
  sessionId: string;
  status: "streaming";
}
```

---

#### `modification:confirm` — 确认修改

**请求**：
```typescript
interface ModificationConfirmRequest {
  sessionId: string;
}
```

**响应**：
```typescript
interface ModificationConfirmResponse {
  appId: string;
  status: "applying";
}
```

---

#### `modification:cancel` — 取消修改

**请求**：
```typescript
interface ModificationCancelRequest {
  sessionId: string;
}
```

**响应**：
```typescript
interface ModificationCancelResponse {
  success: boolean;
}
```

---

---

## contextBridge 暴露结构

完整的 `window.intentOS` 对象结构（TypeScript 接口）：

```typescript
interface IntentOSAPI {
  // Skill 管理
  skill: {
    list(): Promise<{ skills: SkillMeta[]; totalCount: number }>;
    get(skillId: string): Promise<SkillDetail>;
    register(dirPath: string): Promise<{ skillId: string; meta: SkillMeta }>;
    unregister(skillId: string): Promise<{ success: boolean; blockedBy?: string[] }>;
    checkDependencies(skillId: string): Promise<DependencyCheckResult>;
    getRefCount(skillId: string): Promise<{ refCount: number; referencedBy: string[] }>;
    onChanged(callback: (event: SkillChangedEvent) => void): () => void;
  };

  // SkillApp 生命周期
  app: {
    list(): Promise<{ apps: AppRegistryEntry[]; totalCount: number }>;
    getStatus(appId: string): Promise<AppStatusResponse>;
    launch(appId: string): Promise<{ success: boolean; pid?: number }>;
    stop(appId: string): Promise<{ success: boolean }>;
    restart(appId: string): Promise<{ success: boolean; pid?: number }>;
    focusWindow(appId: string): Promise<{ success: boolean }>;
    uninstall(appId: string): Promise<{ success: boolean }>;
    onStatusChanged(callback: (event: AppStatusChangedEvent) => void): () => void;
  };

  // 应用生成
  generation: {
    startPlan(skillIds: string[], intent: string): Promise<{ sessionId: string; status: string }>;
    refinePlan(sessionId: string, feedback: string): Promise<{ status: string }>;
    confirmGenerate(sessionId: string, appName?: string): Promise<{ appId: string; status: string }>;
    startModify(appId: string, requirement: string, newSkillIds?: string[]): Promise<{ sessionId: string; status: string }>;
    confirmApplyModify(sessionId: string): Promise<{ appId: string; status: string }>;
    cancel(sessionId: string): Promise<{ success: boolean }>;
    onPlanUpdate(sessionId: string, callback: (update: PlanUpdate) => void): () => void;
    onBuildProgress(sessionId: string, callback: (progress: BuildProgress) => void): () => void;
    onTransformReady(callback: (event: TransformReadyEvent) => void): () => void;
    onError(sessionId: string, callback: (error: GenerationError) => void): () => void;
  };

  // AI Provider
  aiProvider: {
    plan(request: AIPlanRequest): Promise<{ sessionId: string; status: string }>;
    generate(request: AIGenerateRequest): Promise<{ sessionId: string; status: string }>;
    skillCall(request: SkillCallRequest): Promise<SkillCallResult>;
    cancel(sessionId: string): Promise<{ success: boolean }>;
    status(): Promise<ProviderStatus>;
    onPlanChunk(sessionId: string, callback: (chunk: PlanChunk) => void): () => void;
    onPlanComplete(sessionId: string, callback: () => void): () => void;
    onPlanError(sessionId: string, callback: (error: AIError) => void): () => void;
    onGenProgress(sessionId: string, callback: (chunk: GenProgressChunk) => void): () => void;
    onGenComplete(sessionId: string, callback: (chunk: GenCompleteChunk) => void): () => void;
    onGenError(sessionId: string, callback: (error: AIError) => void): () => void;
    onStatusChanged(callback: (status: ProviderStatus) => void): () => void;
  };

  // 设置
  settings: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<{ success: boolean }>;
    getProviderConfig(): Promise<ProviderConfig>;
    setProviderConfig(config: Partial<ProviderConfig>): Promise<{ success: boolean }>;
    getApiKey(): Promise<{ key: string | null; configured: boolean }>;
    saveApiKey(key: string): Promise<{ success: boolean }>;
    deleteApiKey(): Promise<{ success: boolean }>;
    testConnection(): Promise<{ success: boolean; latencyMs?: number; error?: AIError }>;
    onConnectionStatusChanged(callback: (event: ConnectionStatusChangedEvent) => void): () => void;
  };

  // 修改（在 SkillApp 管理中心中触发）
  modification: {
    start(appId: string, requirement: string, newSkillIds?: string[]): Promise<{ sessionId: string; status: string }>;
    confirm(sessionId: string): Promise<{ appId: string; status: string }>;
    cancel(sessionId: string): Promise<{ success: boolean }>;
    onPlanChunk(sessionId: string, callback: (chunk: PlanChunk) => void): () => void;
    onProgress(sessionId: string, callback: (progress: ModifyProgress) => void): () => void;
    onError(sessionId: string, callback: (error: GenerationError) => void): () => void;
  };
}

declare global {
  interface Window {
    intentOS: IntentOSAPI;
  }
}
```

---

## 流式通道的特殊处理

### 动态 Channel 名称与 sessionId 隔离

规划、生成、修改等长流程使用**动态 channel 名称**，格式为 `domain:action:{sessionId}`，以实现多并发会话的数据流隔离。

**示例**：用户同时启动两个生成会话，sessionId 分别为 `sess-001` 和 `sess-002`，数据流分别通过以下 channel 传输：

- 会话 001：`ai-provider:plan-chunk:sess-001` / `ai-provider:gen-progress:sess-001`
- 会话 002：`ai-provider:plan-chunk:sess-002` / `ai-provider:gen-progress:sess-002`

**主进程转发逻辑**（伪代码）：

```typescript
// M-04 AI Provider 通信层从 Claude API 接收流式数据
for await (const chunk of provider.planApp(request)) {
  // 通过包含 sessionId 的 channel 转发到生成窗口
  mainWindow.webContents.send(`ai-provider:plan-chunk:${sessionId}`, chunk);
}

// 规划完成
mainWindow.webContents.send(`ai-provider:plan-complete:${sessionId}`);
```

### 事件监听器的注册和注销规范

**注册**（渲染进程）：

```typescript
const unsubscribe = window.intentOS.aiProvider.onPlanChunk(sessionId, (chunk) => {
  console.log('Plan chunk:', chunk);
});
```

**注销**（用户切换页面或会话结束时）：

```typescript
unsubscribe();  // 移除监听器，停止接收此 sessionId 的消息
```

**未能及时注销的后果**：若渲染进程页面卸载但未移除监听器，主进程仍会尝试向已销毁的 webContents 发送消息（导致错误被捕获）。为避免泄漏，`ipcRenderer.on()` 应总是返回可调用的注销函数。

### 多并发会话的 Channel 隔离机制

**主进程侧**：

```typescript
class AIProviderBridge {
  private activeSessions = new Map<string, SessionContext>();

  registerHandlers() {
    ipcMain.handle('ai-provider:plan', async (event, request) => {
      const { sessionId } = request;

      // 启动流式响应
      this.streamPlanToRenderer(event, request);

      return { sessionId, status: 'streaming' };
    });
  }

  private async streamPlanToRenderer(event, request) {
    const { sessionId } = request;

    for await (const chunk of this.provider.planApp(request)) {
      // 通过 sessionId 特定的 channel 发送
      event.sender.send(`ai-provider:plan-chunk:${sessionId}`, chunk);
    }

    // 完成信号
    event.sender.send(`ai-provider:plan-complete:${sessionId}`);

    // 清理会话上下文
    this.activeSessions.delete(sessionId);
  }

  // 取消会话时销毁对应的流
  async cancelSession(sessionId: string) {
    const context = this.activeSessions.get(sessionId);
    if (context) {
      context.abortController.abort();
      this.activeSessions.delete(sessionId);
    }
  }
}
```

**渲染进程侧**：

```typescript
// 为每个会话创建独立的事件监听器
const sessionId = generateUUID();

const unsubscribePlanChunk = window.intentOS.aiProvider.onPlanChunk(sessionId, (chunk) => {
  // 仅接收此 sessionId 的消息
  updatePlanDisplay(chunk);
});

const unsubscribePlanError = window.intentOS.aiProvider.onPlanError(sessionId, (error) => {
  showErrorNotification(error);
});

// 用户取消或页面卸载时
function cleanup() {
  unsubscribePlanChunk();
  unsubscribePlanError();
}
```

### 流完成信号

每个流式操作完成时，主进程发送对应的「完成」event：

| 操作 | 完成 Event | 含义 |
|------|-----------|------|
| `ai-provider:plan` | `ai-provider:plan-complete:{sessionId}` | 规划流已全部接收 |
| `ai-provider:generate` | `ai-provider:gen-complete:{sessionId}` | 代码生成完全完成 |
| 错误情况 | `ai-provider:plan-error:{sessionId}` 或 `ai-provider:gen-error:{sessionId}` | 流因错误中断 |

---

## IPC Hub 注册规范（主进程侧）

### ipcMain.handle() vs ipcMain.on() 的使用场景

| 方法 | 使用场景 | 返回值 | 说明 |
|------|---------|--------|------|
| `ipcMain.handle(channel, handler)` | 请求-响应模式 | `Promise<any>` | 渲染进程调用 `ipcRenderer.invoke()`，期望同步等待响应。用于 CRUD 操作、状态查询等。 |
| `ipcMain.on(channel, listener)` | 事件推送（可选回复） | 无 | 渲染进程调用 `ipcRenderer.send()`（发后即忘），主进程通过 `event.sender.send()` 回复或推送数据。用于异步事件、流式数据等。 |

**具体应用**：

```typescript
// 使用 handle：Skill 管理等同步请求
ipcMain.handle('skill:list', async () => {
  return await skillManager.getInstalledSkills();
});

// 使用 on + send：Skill 变更事件推送
skillManager.onSkillChanged((event) => {
  mainWindow.webContents.send('skill-manager:changed', event);
});

// 混合使用：流式操作（invoke 返回初始响应，然后 send 推送流）
ipcMain.handle('ai-provider:plan', async (event, request) => {
  // 立即返回会话 ID 和流状态
  process.nextTick(async () => {
    // 异步开始推送流式数据
    for await (const chunk of provider.planApp(request)) {
      event.sender.send(`ai-provider:plan-chunk:${request.sessionId}`, chunk);
    }
  });
  return { sessionId: request.sessionId, status: 'streaming' };
});
```

### Handler 注册的生命周期管理

**启动时注册**（main 进程初始化）：

```typescript
function initializeIPCHandlers() {
  // Skill 管理器 handlers
  registerSkillManagerHandlers();

  // SkillApp 生命周期 handlers
  registerAppLifecycleHandlers();

  // AI Provider 通信 handlers
  registerAIProviderHandlers();

  // 设置 handlers
  registerSettingsHandlers();

  // 生成器 handlers
  registerGenerationHandlers();

  console.log('IPC Hub 初始化完成');
}

// App 启动后立即调用
app.whenReady().then(() => {
  initializeIPCHandlers();
  // ... 其他初始化逻辑
});
```

**销毁时清理**（应用关闭）：

```typescript
app.on('quit', () => {
  // ipcMain.handle() 和 ipcMain.on() 的监听器会随应用进程自动清理
  // 但需确保其他资源（文件句柄、网络连接等）正确关闭
  aiProvider.dispose();  // 释放 AI Provider 连接
  // ...
});
```

### 错误处理与异常传播

Handler 中抛出异常时的行为：

```typescript
ipcMain.handle('app:launch', async (_, request) => {
  try {
    const result = await lifecycleManager.launchApp(request.appId);
    return result;
  } catch (error) {
    // 异常自动转换为 ipcRenderer.invoke() 的 rejected Promise
    throw new Error(`Failed to launch app: ${error.message}`);
  }
});

// 渲染进程接收
try {
  await window.intentOS.app.launch(appId);
} catch (error) {
  console.error('Launch failed:', error.message);
}
```

---

## 错误传递规范

### 统一错误对象格式

所有 IPC channel 的错误响应应遵循统一格式：

```typescript
interface IPCError {
  code: string;        // 错误码（如 "SKILL_NOT_FOUND", "APP_LAUNCH_FAILED"）
  message: string;     // 用户友好的错误描述
  details?: unknown;   // 额外的诊断信息（日志、堆栈等）
  timestamp: string;   // ISO 8601 时间戳
}
```

### 主进程异常如何传递给渲染进程

**方式 1：ipcRenderer.invoke() 的 rejected Promise**

```typescript
// 主进程：handle 中抛出异常
ipcMain.handle('skill:register', async (_, dirPath) => {
  if (!fs.existsSync(dirPath)) {
    throw new Error('Skill directory not found');
  }
  // ... 注册逻辑
});

// 渲染进程：invoke 捕获异常
try {
  await window.intentOS.skill.register(dirPath);
} catch (error) {
  // error 是 Error 对象，message = "Skill directory not found"
}
```

**方式 2：通过事件发送结构化错误**

```typescript
// 主进程：流式操作中的错误
ipcMain.handle('ai-provider:plan', async (event, request) => {
  try {
    for await (const chunk of provider.planApp(request)) {
      event.sender.send(`ai-provider:plan-chunk:${sessionId}`, chunk);
    }
  } catch (error) {
    // 发送结构化错误事件
    event.sender.send(`ai-provider:plan-error:${sessionId}`, {
      code: mapErrorCode(error),
      message: error.message,
      details: { cause: error.cause },
      timestamp: new Date().toISOString(),
    });
  }
});

// 渲染进程
window.intentOS.aiProvider.onPlanError(sessionId, (error) => {
  console.error(`[${error.code}] ${error.message}`);
});
```

### 常见错误码表

| 错误码 | HTTP 状态 | 说明 | 恢复方案 |
|--------|----------|------|---------|
| `SKILL_NOT_FOUND` | 404 | Skill ID 不存在 | 用户刷新 Skill 列表 |
| `SKILL_IN_USE` | 409 | 无法卸载正在使用的 Skill | 先卸载引用它的 SkillApp |
| `APP_NOT_FOUND` | 404 | SkillApp ID 不存在 | 用户刷新 App 列表 |
| `APP_ALREADY_RUNNING` | 409 | 重复启动已运行的 App | 自动跳过或聚焦窗口 |
| `API_KEY_INVALID` | 401 | Claude API Key 无效 | 提示用户重新输入 Key |
| `RATE_LIMITED` | 429 | API 配额受限 | 自动重试（指数退避） |
| `NETWORK_UNAVAILABLE` | - | 网络不可用 | 检查网络连接，提示用户 |
| `SESSION_CANCELLED` | - | 会话被用户取消 | 静默处理，回退 UI |
| `CODEGEN_FAILED` | - | AI 代码生成失败 | 提示用户简化需求或重试 |
| `COMPILE_FAILED` | - | 编译失败 | 提示用户联系支持，导出日志 |

---

## 数据流完整示例

### 示例 1：启动应用生成流程（规划 + 生成）

```mermaid
sequenceDiagram
    participant U as 用户
    participant GW as 生成窗口 (Renderer)
    participant Hub as IPC Hub (Main)
    participant M05 as M-05 生成器
    participant M04 as M-04 AI Provider
    participant Claude as Claude API

    U->>GW: 选择 Skill，输入意图，点击「开始规划」
    GW->>Hub: invoke('generation:start-plan', {skillIds, intent})

    activate Hub
    Hub->>M05: startPlanSession(skillIds, intent)

    activate M05
    M05->>Hub: invoke('ai-provider:plan', {sessionId, intent, skills})

    activate Hub
    Hub->>M04: planApp(request)

    activate M04
    M04->>Claude: HTTPS SSE: messages.stream()

    loop 流式接收
        Claude-->>M04: SSE text_delta
        M04-->>Hub: plan chunk
        Hub-->>GW: send('ai-provider:plan-chunk:{sid}', chunk)
        GW-->>U: 实时显示思考过程
    end

    Claude-->>M04: message_stop
    M04-->>Hub: send('ai-provider:plan-complete:{sid}')
    deactivate M04
    GW-->>U: 显示规划方案

    U->>GW: 审核方案，点击「生成」
    GW->>Hub: invoke('generation:confirm-generate', {sessionId})

    Hub->>M05: confirmAndGenerate(sessionId)
    M05->>Hub: invoke('ai-provider:generate', {sessionId, plan, appId})

    activate Hub
    Hub->>M04: generateCode(request)

    activate M04
    M04->>Claude: Claude Agent query (with tools)

    loop 代码生成循环
        Claude-->>M04: tool_use event
        M04-->>Hub: gen progress
        Hub-->>GW: send('ai-provider:gen-progress:{sid}', progress)
        GW-->>U: 更新进度条
    end

    Claude-->>M04: generation complete
    M04-->>Hub: send('ai-provider:gen-complete:{sid}')
    deactivate M04

    Hub->>M05: 编译成功，注册 App
    M05-->>GW: send('generation:transform-ready', {appId, bounds})
    deactivate M05

    GW->>GW: 执行原地变形（淡出→淡入→销毁）
    GW-->>U: SkillApp UI 渲染完成
    deactivate Hub
    deactivate GW
```

---

## 附录：Channel 快速参考表

| Domain | Action | 方向 | 类型 |
|--------|--------|------|------|
| `skill` | `list` | → | 请求-响应 |
| `skill` | `get` | → | 请求-响应 |
| `skill` | `register` | → | 请求-响应 |
| `skill` | `unregister` | → | 请求-响应 |
| `skill` | `check-dependencies` | → | 请求-响应 |
| `skill` | `get-ref-count` | → | 请求-响应 |
| `skill-manager` | `changed` | ← | 事件 |
| `app` | `list` | → | 请求-响应 |
| `app` | `get-status` | → | 请求-响应 |
| `app` | `launch` | → | 请求-响应 |
| `app` | `stop` | → | 请求-响应 |
| `app` | `restart` | → | 请求-响应 |
| `app` | `focus-window` | → | 请求-响应 |
| `app` | `uninstall` | → | 请求-响应 |
| `app-lifecycle` | `status-changed` | ← | 事件 |
| `generation` | `start-plan` | → | 请求-响应 |
| `generation` | `refine-plan` | → | 请求-响应 |
| `generation` | `confirm-generate` | → | 请求-响应 |
| `generation` | `start-modify` | → | 请求-响应 |
| `generation` | `confirm-apply-modify` | → | 请求-响应 |
| `generation` | `cancel` | → | 请求-响应 |
| `generation` | `plan-update:{sessionId}` | ← | 事件（流） |
| `generation` | `build-progress:{sessionId}` | ← | 事件（流） |
| `generation` | `transform-ready` | ← | 事件 |
| `generation` | `error:{sessionId}` | ← | 事件 |
| `ai-provider` | `plan` | → | 请求-响应 |
| `ai-provider` | `generate` | → | 请求-响应 |
| `ai-provider` | `skill-call` | → | 请求-响应 |
| `ai-provider` | `cancel` | → | 请求-响应 |
| `ai-provider` | `status` | → | 请求-响应 |
| `ai-provider` | `plan-chunk:{sessionId}` | ← | 事件（流） |
| `ai-provider` | `plan-complete:{sessionId}` | ← | 事件 |
| `ai-provider` | `plan-error:{sessionId}` | ← | 事件 |
| `ai-provider` | `gen-progress:{sessionId}` | ← | 事件（流） |
| `ai-provider` | `gen-complete:{sessionId}` | ← | 事件 |
| `ai-provider` | `gen-error:{sessionId}` | ← | 事件 |
| `ai-provider` | `status-changed` | ← | 事件 |
| `settings` | `get` | → | 请求-响应 |
| `settings` | `set` | → | 请求-响应 |
| `settings` | `get-provider-config` | → | 请求-响应 |
| `settings` | `set-provider-config` | → | 请求-响应 |
| `settings` | `get-api-key` | → | 请求-响应 |
| `settings` | `save-api-key` | → | 请求-响应 |
| `settings` | `delete-api-key` | → | 请求-响应 |
| `settings` | `test-connection` | → | 请求-响应 |
| `settings` | `connection-status-changed` | ← | 事件 |
| `modification` | `start` | → | 请求-响应 |
| `modification` | `confirm` | → | 请求-响应 |
| `modification` | `cancel` | → | 请求-响应 |
| `modification` | `plan-chunk:{sessionId}` | ← | 事件（流） |
| `modification` | `progress:{sessionId}` | ← | 事件（流） |
| `modification` | `error:{sessionId}` | ← | 事件 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-03-13 | 初始版本，涵盖 Iter 2 所有 IPC 通道定义 |

