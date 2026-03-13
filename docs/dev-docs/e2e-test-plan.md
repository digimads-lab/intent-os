# IntentOS E2E 测试计划

> **版本**：v1.0 | **日期**：2026-03-13
> **状态**：Iter 6 test-engineer 执行规范
> **用途**：Playwright E2E 测试套件实现指南，覆盖三条核心业务流程

---

## 1. 测试环境配置

### 1.1 Playwright 配置

IntentOS Desktop 运行在 Electron 应用中，使用 Playwright 的 `_electron.launch()` API 启动并控制。

**配置文件**：`playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,  // 按序执行，避免多窗口冲突

  timeout: 60 * 1000,  // 单个测试超时 60s（生成流程耗时较长）

  expect: {
    timeout: 5 * 1000  // expect 断言超时 5s
  },

  // 重试配置：CI 环境重试 2 次，本地开发不重试
  retries: process.env.CI ? 2 : 0,

  use: {
    // Electron 应用特定配置
    launchArgs: ['--disable-gpu'],  // 禁用 GPU 加速，确保测试稳定性
    locale: 'en-US',
  },

  webServer: {
    // Claude Stub 在测试前启动
    command: 'npm run claude-stub',
    port: 3001,
    reuseExistingServer: process.env.CI ? false : true,
    env: {
      ANTHROPIC_BASE_URL: 'http://localhost:3001',
    },
  },

  projects: [
    {
      name: 'electron',
      use: { ...devices['desktop chromium'] },
    },
  ],

  reporter: [
    ['html', { open: 'never', outputFolder: 'test-reports/e2e' }],
    ['json', { outputFile: 'test-reports/e2e/results.json' }],
    ['junit', { outputFile: 'test-reports/e2e/junit.xml' }],
  ],
});
```

### 1.2 Claude Stub 作为 AI 后端

**为什么使用 Stub？**
- 避免依赖真实 Claude API（配额消耗、网络延迟、成本）
- 支持故意注入特定场景（高延迟、错误、限速）
- 保证测试可重复、结果确定

**启动方式**：
```bash
# 开发测试
npm run claude-stub                    # 正常模式
MOCK_LATENCY=500 npm run claude-stub   # 注入 500ms 流式延迟
MOCK_ERROR_RATE=0.2 npm run claude-stub # 注入 20% 随机失败率

# E2E 测试自动启动（playwright.config.ts 中 webServer 配置）
```

**Stub 端口**：`3001`（通过环境变量 `ANTHROPIC_BASE_URL=http://localhost:3001` 重定向 SDK 请求）

**Stub 提供的控制接口**（`tests/e2e/helpers/mock-server.ts`）：
```typescript
interface MockServer {
  // 启动 Stub 服务器
  start(): Promise<{ port: number }>

  // 停止 Stub 服务器
  stop(): Promise<void>

  // 切换预设场景：normal | compile-error | rate-limit | network-error
  setScenario(scenario: StubScenario): Promise<void>

  // 动态修改行为：延迟、错误率等
  setConfig(config: StubConfig): Promise<void>

  // 重置状态
  reset(): Promise<void>
}

type StubScenario = 'normal' | 'compile-error' | 'rate-limit' | 'network-error'

interface StubConfig {
  latency?: number           // 流式延迟（毫秒）
  errorRate?: number         // 错误率 0-1
  scenario?: StubScenario
}
```

### 1.3 测试前置流程

**启动顺序**（Playwright hooks 中执行）：

```typescript
test.beforeAll(async () => {
  // 1. 启动 Claude Stub（playwright.config.ts 中已配置自动启动）

  // 2. 初始化 Electron 应用
  electronApp = await electron.launch({
    args: ['--disable-gpu'],
  })

  mainWindow = await electronApp.firstWindow()

  // 3. 配置 API Key
  await mainWindow.evaluate(() => {
    window.localStorage.setItem('apiKey', 'test-key-from-stub')
  })

  // 4. 验证 Desktop 启动成功（加载 Sidebar）
  await mainWindow.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 })
})
```

### 1.4 测试后置流程

```typescript
test.afterAll(async () => {
  // 1. 关闭所有 SkillApp 进程
  // （lifecycle-manager 会自动清理）

  // 2. 关闭 Electron 应用
  await electronApp.close()

  // 3. 停止 Claude Stub
  // （如果手动启动；自动启动的由 playwright 管理）
})
```

---

## 2. 测试辅助工具（Mock Server）

### 2.1 MockServer 接口规范

**文件路径**：`tests/e2e/helpers/mock-server.ts`

```typescript
import axios from 'axios'

export class MockServer {
  private baseUrl: string = 'http://localhost:3001'

  async start(): Promise<{ port: number }> {
    try {
      // 检查 Stub 是否已启动
      await axios.get(`${this.baseUrl}/health`)
      return { port: 3001 }
    } catch {
      throw new Error('Claude Stub failed to start')
    }
  }

  async stop(): Promise<void> {
    // 调用 Stub 的 shutdown 端点（如果支持）
    try {
      await axios.post(`${this.baseUrl}/shutdown`)
    } catch (e) {
      // Stub 可能已经停止
    }
  }

  async setScenario(scenario: StubScenario): Promise<void> {
    await axios.post(`${this.baseUrl}/stub/scenario`, { scenario })
  }

  async setConfig(config: StubConfig): Promise<void> {
    await axios.post(`${this.baseUrl}/stub/config`, config)
  }

  async reset(): Promise<void> {
    await axios.post(`${this.baseUrl}/stub/reset`)
  }
}
```

### 2.2 与 Claude Stub 的交互

**规划请求流**（`/stub/scenario: 'normal'`）：
```
1. Desktop 调用 provider.planApp(intent, skillIds)
2. SDK 发送 HTTPS 请求到 http://localhost:3001（重定向）
3. Stub 返回 SSE 流式响应：
   - 每 200ms 返回一个 content_block_delta 事件（共 8 个）
   - 最后返回包含 JSON 规划结果的 message_stop 事件
   - Desktop 渲染进程实时展示 8 个 PlanChunk，最后显示 PlanResult
```

**代码生成流**（`/stub/scenario: 'normal'`）：
```
1. Desktop 调用 provider.generateCode(plan, appId)
2. Stub 返回 Claude Agent SDK 工具调用序列：
   - write_file × 3 → GenProgressChunk { phase: 'codegen', progress: 30/40/50 }
   - run_command('tsc') → GenProgressChunk { phase: 'compile', progress: 60/80 }
   - run_command('bundle') → GenProgressChunk { phase: 'bundle', progress: 90/100 }
   - 最后 GenCompleteChunk { entryPoint, outputDir }
```

---

## 3. 测试套件 1：生成流程（generation-flow.spec.ts）

**覆盖**：意图输入 → 规划多轮交互 → 确认生成 → 编译打包 → 原地变形

### 3.1 测试用例：正常生成流程端到端

**Given**：
- Desktop 已启动，Claude Stub 处于 `normal` 场景
- 已有 2 个 Skill 注册（`test-skill-a`, `test-skill-b`）
- Skill 元数据从 SQLite 正确加载到内存

**When**：
```typescript
test('end-to-end generation flow: intent → plan → generate → morph', async ({ page }) => {
  // 1. 点击「新建应用」
  await page.click('[data-testid="btn-new-app"]')

  // 2. 验证生成窗口打开（阶段 1）
  const generationWindow = await page.locator('[data-testid="generation-window"]')
  await expect(generationWindow).toBeVisible()

  // 3. 选择 2 个 Skill
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.click('[data-testid="skill-checkbox-test-skill-b"]')

  // 4. 输入意图文本
  await page.fill('[data-testid="intent-input"]', '创建一个待办事项管理应用')

  // 5. 点击「下一步」进入规划（阶段 2）
  await page.click('[data-testid="btn-next-to-plan"]')
```

**Then**：
```typescript
  // 6. 验证进入规划阶段，实时展示 PlanChunk
  const planDisplay = await page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).toBeVisible()

  // 监控流式 PlanChunk 更新（使用 poll 等待异步内容）
  await expect
    .poll(async () => {
      const planText = await planDisplay.textContent()
      return planText?.split('\n').length ?? 0  // 等待 8 个 chunk
    }, { timeout: 10000 })
    .toBe(8)

  // 7. 验证最终 PlanResult 展示（含应用架构、页面设计等）
  const planResult = await page.locator('[data-testid="plan-result"]')
  await expect(planResult).toContainText('应用架构')
  await expect(planResult).toContainText('页面设计')

  // 8. 点击「确认生成」进入代码生成（阶段 3）
  await page.click('[data-testid="btn-confirm-generate"]')
```

**When（续）**：
```typescript
  // 9. 验证进度条依次推进：codegen(40%) → compile(80%) → bundle(100%)
  const progressBar = await page.locator('[data-testid="progress-bar"]')

  // 使用 poll 等待进度条推进（每 100ms 检查一次）
  await expect
    .poll(async () => {
      const text = await progressBar.textContent()
      // 例如 "代码生成中 40%"
      return text
    }, { timeout: 30000 })
    .toContain('100%')

  // 10. 验证进度条推进完成后触发原地变形
  // 使用 poll 等待窗口位置/内容变化（原地变形的关键断言）
  const skillAppUI = await page.locator('[data-testid="skillapp-ui"]')
  await expect
    .poll(async () => {
      // 原地变形完成后，窗口内容从「生成进度」切换为「SkillApp 界面」
      return await skillAppUI.isVisible()
    }, { timeout: 15000 })
    .toBe(true)
```

**Then（续）**：
```typescript
  // 11. 验证原地变形完成后 SkillApp 可交互
  // 验证应用标题已更新
  const windowTitle = await page.title()
  expect(windowTitle).toContain('待办事项')

  // 验证应用首屏内容可见（说明首屏渲染成功）
  const appContent = await page.locator('[data-testid="app-main-content"]')
  await expect(appContent).toBeVisible({ timeout: 5000 })
})
```

### 3.2 测试用例：规划阶段多轮交互

**Given**：
- Desktop 处于规划阶段（已展示初始方案）
- Claude Stub 处于 `normal` 场景

**When**：
```typescript
test('multi-round planning interaction', async ({ page }) => {
  // 1. 从前一个测试的状态继续（或重新进入规划阶段）

  // 2. 在反馈框输入「请增加数据导出功能」
  const feedbackInput = await page.locator('[data-testid="plan-feedback-input"]')
  await feedbackInput.fill('请增加数据导出功能')

  // 3. 点击「重新规划」
  await page.click('[data-testid="btn-replan"]')
```

**Then**：
```typescript
  // 4. 验证新的 PlanChunk 流式展示（context 累积）
  const planDisplay = await page.locator('[data-testid="plan-display"]')

  // 等待新的 plan chunk 开始更新
  await expect
    .poll(async () => {
      const text = await planDisplay.textContent()
      // 等待包含「导出」相关内容的新规划
      return text?.includes('导出') ? true : false
    }, { timeout: 10000 })
    .toBe(true)

  // 5. 验证最终 PlanResult 包含导出相关模块
  const planResult = await page.locator('[data-testid="plan-result"]')
  const planText = await planResult.textContent()
  expect(planText).toContain('导出模块')
  expect(planText).toContain('ExportService')
})
```

### 3.3 测试用例：生成失败重试

**Given**：
- Claude Stub 设置为 `compile-error` 场景（生成代码含 TypeScript 错误）
- 设置最多重试 3 次

**When**：
```typescript
test('generation failure with automatic retry', async ({ page }) => {
  // 1. 设置 Stub 场景为 compile-error
  const mockServer = new MockServer()
  await mockServer.setScenario('compile-error')

  // 2. 触发生成（前续步骤同「正常生成流程」）
  await page.click('[data-testid="btn-new-app"]')
  // ... Skill 选择、意图输入 ...
  await page.click('[data-testid="btn-confirm-generate"]')
```

**Then**：
```typescript
  // 3. 监控编译失败 → 自动重试
  const progressBar = await page.locator('[data-testid="progress-bar"]')
  const errorDisplay = await page.locator('[data-testid="error-message"]')

  // 等待显示「编译失败，正在重试（1/3）」
  await expect(errorDisplay).toContainText('编译失败，正在重试（1/3）', { timeout: 10000 })

  // 重试 2 次
  await expect(errorDisplay).toContainText('（2/3）', { timeout: 10000 })
  await expect(errorDisplay).toContainText('（3/3）', { timeout: 10000 })

  // 4. 第 3 次重试后仍然失败，显示「生成失败」和详细错误
  await expect(errorDisplay).toContainText('生成失败', { timeout: 10000 })

  // 验证显示错误详情（例如 TypeScript 错误信息）
  const errorDetails = await page.locator('[data-testid="error-details"]')
  await expect(errorDetails).toContainText('TS')  // TypeScript 错误代码

  // 5. 验证提供「返回修改方案」和「重试」按钮
  const btnRetry = await page.locator('[data-testid="btn-retry-generation"]')
  const btnBack = await page.locator('[data-testid="btn-back-to-plan"]')
  await expect(btnRetry).toBeVisible()
  await expect(btnBack).toBeVisible()
})
```

### 3.4 测试用例：Claude Stub 高延迟下 UI 不卡死

**Given**：
- Claude Stub 设置 `MOCK_LATENCY=500`（每个流式事件延迟 500ms）
- Desktop 应保持响应

**When**：
```typescript
test('UI remains responsive under high latency', async ({ page }) => {
  // 1. 设置 Stub 高延迟
  const mockServer = new MockServer()
  await mockServer.setConfig({ latency: 500 })

  // 2. 触发规划（阶段 2）
  await page.click('[data-testid="btn-new-app"]')
  // ... 前续步骤 ...
  await page.click('[data-testid="btn-next-to-plan"]')
```

**Then**：
```typescript
  // 3. 验证 UI 保持响应：加载动画显示，进度条缓慢推进
  const loadingSpinner = await page.locator('[data-testid="loading-spinner"]')
  await expect(loadingSpinner).toBeVisible()  // 加载动画一直显示

  // 4. 验证可以在规划进行中点击其他按钮（例如「返回」或「取消」）
  const btnCancel = await page.locator('[data-testid="btn-cancel-plan"]')
  await expect(btnCancel).toBeEnabled()

  // 点击「返回」应立即响应（不会卡死）
  const btnBack = await page.locator('[data-testid="btn-back"]')
  await btnBack.click()

  // 5. 验证返回成功（规划对话框关闭）
  const planDisplay = await page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).not.toBeVisible({ timeout: 5000 })
})
```

### 3.5 生成流程断言规范

**动画与异步操作**：禁止使用 `await page.waitForTimeout()`，必须使用 `expect.poll()`：

```typescript
// ❌ 错误：硬编码等待，不可靠
await page.waitForTimeout(2000)

// ✅ 正确：轮询直到条件满足，最多等待 5s
await expect
  .poll(async () => {
    const text = await page.locator('[data-testid="progress"]').textContent()
    return text?.includes('100%')
  }, { timeout: 5000 })
  .toBe(true)
```

**截图存档**（原地变形视觉验证）：

```typescript
// 验证原地变形窗口切换
await page.screenshot({ path: 'test-reports/e2e/screenshots/generation-before-morph.png' })
// ... 触发原地变形 ...
await expect.poll(...).toBe(true)
await page.screenshot({ path: 'test-reports/e2e/screenshots/generation-after-morph.png' })
```

---

## 4. 测试套件 2：修改流程（modification-flow.spec.ts）

**覆盖**：修改需求 → 增量规划 → 增量生成 → 热更新 → 回滚

### 4.1 测试用例：正常修改流程端到端

**Given**：
- 已有运行中的 SkillApp（从前一测试的「生成流程」继续）
- Claude Stub 处于 `normal` 场景
- SkillApp 中用户已填写表单数据（待办事项列表）

**When**：
```typescript
test('end-to-end modification flow: intent → incremental plan → hot update', async ({ page }) => {
  // 1. 在 SkillApp 中预先填写表单数据（待办事项列表）
  const todoInput = await page.locator('[data-testid="todo-input"]')
  await todoInput.fill('完成 E2E 测试')
  await page.click('[data-testid="btn-add-todo"]')

  // 2. 验证数据已保存到 Zustand store（检查 DOM）
  const todoList = await page.locator('[data-testid="todo-list"]')
  await expect(todoList).toContainText('完成 E2E 测试')

  // 3. 点击「修改」按钮
  await page.click('[data-testid="btn-modify-app"]')

  // 4. 修改窗口打开
  const modifyWindow = await page.locator('[data-testid="modification-window"]')
  await expect(modifyWindow).toBeVisible()
```

**When（续）**：
```typescript
  // 5. 输入修改需求「改变主题颜色为深色模式」
  const intentInput = await page.locator('[data-testid="modify-intent-input"]')
  await intentInput.fill('改变主题颜色为深色模式')

  // 6. 点击「生成增量方案」
  await page.click('[data-testid="btn-generate-plan"]')
```

**Then**：
```typescript
  // 7. 验证显示增量方案（新增/修改/不变三分类）
  const diffView = await page.locator('[data-testid="diff-view"]')
  await expect(diffView).toBeVisible()

  // 等待增量方案加载完成
  await expect
    .poll(async () => {
      const content = await diffView.textContent()
      return content?.includes('ThemeProvider') ? true : false
    }, { timeout: 10000 })
    .toBe(true)

  // 验证三个分类显示
  const addedSection = await page.locator('[data-testid="diff-added"]')
  const modifiedSection = await page.locator('[data-testid="diff-modified"]')
  const unchangedSection = await page.locator('[data-testid="diff-unchanged"]')

  await expect(addedSection).toBeVisible()      // 新增：DarkModeToggle 组件
  await expect(modifiedSection).toBeVisible()   // 修改：App.tsx 主题逻辑
  await expect(unchangedSection).toBeVisible()  // 不变：TodoItem 组件

  // 8. 点击「确认更新」
  await page.click('[data-testid="btn-confirm-update"]')
```

**When（续）**：
```typescript
  // 9. 验证热更新进度条
  const updateProgress = await page.locator('[data-testid="update-progress"]')
  await expect(updateProgress).toBeVisible()

  // 等待热更新完成（进度到 100%）
  await expect
    .poll(async () => {
      const text = await updateProgress.textContent()
      return text?.includes('100%')
    }, { timeout: 15000 })
    .toBe(true)

  // 10. 修改窗口关闭
  await expect(modifyWindow).not.toBeVisible()

  // 11. 焦点回到 SkillApp
  const appUI = await page.locator('[data-testid="skillapp-ui"]')
  await expect(appUI).toBeFocused()
```

**Then（续）**：
```typescript
  // 12. 验证 SkillApp UI 已更新（深色模式主题生效）
  const themeStyle = await page.locator('html').evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor
  })

  // 验证背景色已切换为深色
  expect(themeStyle).toMatch(/rgb\((2\d|[1-9]|0),/)  // 深色背景 R/G/B 较低

  // 13. 验证之前填写的表单数据仍然存在（Zustand store 保持）
  const todoList = await page.locator('[data-testid="todo-list"]')
  await expect(todoList).toContainText('完成 E2E 测试')
})
```

### 4.2 测试用例：热更新回滚

**Given**：
- 运行中的 SkillApp
- Claude Stub 设置为生成会导致崩溃的代码（例如 runtime error）

**When**：
```typescript
test('hot update rollback on crash', async ({ page }) => {
  // 1. 设置 Stub 生成包含运行时错误的代码
  const mockServer = new MockServer()
  await mockServer.setScenario('crash-on-render')  // 自定义场景

  // 2. 修改应用（前述步骤）
  await page.click('[data-testid="btn-modify-app"]')
  // ... 输入修改需求、生成增量方案 ...
  await page.click('[data-testid="btn-confirm-update"]')
```

**Then**：
```typescript
  // 3. 等待热更新完成（进度到 100%）
  const updateProgress = await page.locator('[data-testid="update-progress"]')
  await expect
    .poll(async () => {
      const text = await updateProgress.textContent()
      return text?.includes('100%')
    }, { timeout: 10000 })
    .toBe(true)

  // 4. SkillApp 崩溃（首屏渲染失败，生命周期管理器检测到）
  // 验证崩溃状态：窗口可能变白或显示错误
  const errorBoundary = await page.locator('[data-testid="error-boundary"]')
  await expect(errorBoundary).toBeVisible({ timeout: 5000 })

  // 5. 自动回滚：SkillApp 重启，加载备份文件
  // 验证应用恢复（加载动画 → 主界面）
  const loadingSpinner = await page.locator('[data-testid="loading-spinner"]')
  await expect(loadingSpinner).toBeVisible()

  await expect
    .poll(async () => {
      return await page.locator('[data-testid="skillapp-ui"]').isVisible()
    }, { timeout: 10000 })
    .toBe(true)

  // 6. Desktop 状态栏或通知显示「已回滚」提示
  const rollbackNotification = await page.locator('[data-testid="rollback-notification"]')
  await expect(rollbackNotification).toContainText('已回滚到修改前版本')
})
```

### 4.3 测试用例：热更新后用户状态保留

**Given**：
- SkillApp 中用户已填写复杂表单数据
- Zustand store 已持久化该数据

**When**：
```typescript
test('user state preservation after hot update', async ({ page }) => {
  // 1. 在 SkillApp 中填写复杂表单
  const form = await page.locator('[data-testid="form"]')
  await form.locator('input[name="title"]').fill('项目名称')
  await form.locator('input[name="description"]').fill('详细描述...')

  // 获取 Zustand store 的当前状态
  const initialState = await page.evaluate(() => {
    return (window as any).__zustandStore?.getState?.()
  })
  expect(initialState.title).toBe('项目名称')

  // 2. 修改应用（热更新）
  await page.click('[data-testid="btn-modify-app"]')
  // ... 前述步骤 ...
  await page.click('[data-testid="btn-confirm-update"]')

  // 等待热更新完成
  await expect
    .poll(async () => {
      const text = await page.locator('[data-testid="update-progress"]').textContent()
      return text?.includes('100%')
    }, { timeout: 10000 })
    .toBe(true)
```

**Then**：
```typescript
  // 3. 验证热更新后状态仍然存在
  const finalState = await page.evaluate(() => {
    return (window as any).__zustandStore?.getState?.()
  })
  expect(finalState.title).toBe('项目名称')
  expect(finalState.description).toBe('详细描述...')

  // 4. 验证表单界面仍然显示数据（UI 层重新渲染但状态保持）
  const titleInput = await page.locator('input[name="title"]')
  const titleValue = await titleInput.inputValue()
  expect(titleValue).toBe('项目名称')
})
```

---

## 5. 测试套件 3：Skill 管理（skill-management.spec.ts）

**覆盖**：注册本地 Skill、卸载被引用的 Skill、卸载未被引用的 Skill

### 5.1 测试用例：注册本地 Skill

**Given**：
- 存在合法的 Skill 目录（`tests/fixtures/skills/test-skill-a/`，含 `skill.json`）
- Skill 管理中心已打开

**When**：
```typescript
test('register local skill', async ({ page }) => {
  // 1. 打开 Skill 管理中心
  await page.click('[data-testid="nav-skills"]')

  // 2. 点击「注册 Skill」按钮
  await page.click('[data-testid="btn-register-skill"]')

  // 3. 弹出路径输入对话框
  const dialog = await page.locator('[data-testid="register-dialog"]')
  await expect(dialog).toBeVisible()

  // 4. 输入 Skill 目录路径
  const pathInput = await dialog.locator('input[type="text"]')
  const skillPath = path.resolve(__dirname, '../fixtures/skills/test-skill-a')
  await pathInput.fill(skillPath)

  // 5. 点击「注册」
  await dialog.locator('[data-testid="btn-confirm"]').click()
```

**Then**：
```typescript
  // 6. 验证 Skill 出现在列表中
  const skillList = await page.locator('[data-testid="skill-list"]')

  // 使用 poll 等待 Skill 加载
  await expect
    .poll(async () => {
      const items = await skillList.locator('[data-testid^="skill-item-"]').count()
      return items
    }, { timeout: 5000 })
    .toBeGreaterThan(0)

  // 7. 验证 Skill 卡片显示正确信息
  const skillCard = await skillList.locator('[data-testid="skill-item-test-skill-a"]')
  await expect(skillCard).toContainText('Test Skill A')        // 名称
  await expect(skillCard).toContainText('1.0.0')              // 版本
  await expect(skillCard).toContainText('数据处理工具')        // 描述
})
```

### 5.2 测试用例：卸载被引用的 Skill

**Given**：
- Skill 被 1 个 SkillApp 引用（从「生成流程」测试中已生成）
- Skill 管理中心已打开

**When**：
```typescript
test('uninstall referenced skill shows dependent apps', async ({ page }) => {
  // 1. 打开 Skill 管理中心
  await page.click('[data-testid="nav-skills"]')

  // 2. 找到被引用的 Skill（例如 test-skill-a）
  const skillCard = await page.locator('[data-testid="skill-item-test-skill-a"]')

  // 3. 点击「卸载」按钮
  await skillCard.locator('[data-testid="btn-uninstall"]').click()
```

**Then**：
```typescript
  // 4. 弹出确认对话框，显示被引用的 AppId
  const confirmDialog = await page.locator('[data-testid="uninstall-confirm-dialog"]')
  await expect(confirmDialog).toBeVisible()

  // 验证对话框内容
  const dialogText = await confirmDialog.textContent()
  expect(dialogText).toContain('该 Skill 被以下应用引用：')
  expect(dialogText).toContain('待办事项管理应用')  // 被引用的 App 名称

  // 5. 点击「取消」或「确认」
  // 这里验证是否能点击「取消」（测试先取消）
  await confirmDialog.locator('[data-testid="btn-cancel"]').click()

  // 6. 对话框关闭，Skill 仍在列表中
  await expect(confirmDialog).not.toBeVisible()
  await expect(skillCard).toBeVisible()
})
```

### 5.3 测试用例：卸载未被引用的 Skill

**Given**：
- Skill 引用计数为 0（test-skill-b 未被任何 App 使用）
- Skill 管理中心已打开

**When**：
```typescript
test('uninstall unreferenced skill succeeds immediately', async ({ page }) => {
  // 1. 打开 Skill 管理中心
  await page.click('[data-testid="nav-skills"]')

  // 2. 找到未被引用的 Skill（test-skill-b）
  const skillCard = await page.locator('[data-testid="skill-item-test-skill-b"]')
  await expect(skillCard).toBeVisible()

  // 3. 点击「卸载」按钮
  await skillCard.locator('[data-testid="btn-uninstall"]').click()
```

**Then**：
```typescript
  // 4. 由于未被引用，卸载立即完成（可能不显示确认对话框，或显示简单确认）
  // 使用 poll 等待 Skill 从列表移除
  await expect
    .poll(async () => {
      const skillItem = await page.locator('[data-testid="skill-item-test-skill-b"]')
      return await skillItem.isVisible()
    }, { timeout: 5000 })
    .toBe(false)

  // 5. 验证列表已更新
  const skillList = await page.locator('[data-testid="skill-list"]')
  const itemCount = await skillList.locator('[data-testid^="skill-item-"]').count()
  expect(itemCount).toBeLessThan(2)  // 卸载前至少有 2 个
})
```

---

## 6. 测试套件 4：原地变形（morphing.spec.ts）

**覆盖**：窗口位置切换、视觉连续性、超时降级

### 6.1 测试用例：原地变形窗口切换（macOS）

**Given**：
- 生成流程已完成，进度条到达 100%
- 使用方案 C（混合预热+淡入淡出）

**When**：
```typescript
test('morphing window position unchanged (macOS)', async ({ page }) => {
  // 1. 从「生成流程」测试继续（生成完成，进度条 100%）

  // 2. 记录生成窗口的位置和尺寸（在淡出动画前）
  const generationWindow = await page.locator('[data-testid="generation-window"]')
  const beforeBounds = await generationWindow.evaluate((el: any) => {
    const bounds = el.getBoundingClientRect()
    return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
  })

  console.log('Before morph bounds:', beforeBounds)
```

**Then**：
```typescript
  // 3. 等待原地变形完成（使用 poll）
  // 原地变形的关键特征：
  // - 窗口内容从「生成进度」切换为「SkillApp UI」
  // - 窗口位置基本不变（可能有微小偏差）
  // - 视觉上是淡出 → 淡入的过渡，不是闪烁

  const skillAppUI = await page.locator('[data-testid="skillapp-ui"]')

  await expect
    .poll(async () => {
      return await skillAppUI.isVisible()
    }, { timeout: 15000 })
    .toBe(true)

  // 4. 验证窗口位置基本不变
  const afterBounds = await page.locator('html').evaluate((el: any) => {
    const bounds = el.getBoundingClientRect()
    return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
  })

  console.log('After morph bounds:', afterBounds)

  // 允许 10px 的偏差（DPI 缩放等原因）
  expect(Math.abs(beforeBounds.x - afterBounds.x)).toBeLessThan(10)
  expect(Math.abs(beforeBounds.y - afterBounds.y)).toBeLessThan(10)
  expect(Math.abs(beforeBounds.width - afterBounds.width)).toBeLessThan(20)
  expect(Math.abs(beforeBounds.height - afterBounds.height)).toBeLessThan(20)

  // 5. 截图存档（对比变形前后）
  await page.screenshot({
    path: path.join(process.cwd(), 'test-reports/e2e/screenshots/morph-after.png')
  })
})
```

### 6.2 测试用例：原地变形超时降级

**Given**：
- Mock SkillApp 进程不发送 ready 信号（无限等待）
- 超时阈值为 15 秒

**When**：
```typescript
test('morphing timeout fallback to direct switch', async ({ page }) => {
  // 1. 在生成流程中，mock 生成成功但 SkillApp 进程卡住
  // （这需要在 mock-server 中支持，或在生成器中 inject 故障）

  // 2. 继续触发生成，等待进度条到 100%
  // ... （与「生成流程」测试类似）...

  // 3. 不发送 ready 信号的 SkillApp 进程启动
  // （mock 或真实进程卡在首屏加载）
```

**Then**：
```typescript
  // 4. 等待 15 秒超时，验证降级直接切换
  const progressBar = await page.locator('[data-testid="progress-bar"]')
  const skillAppUI = await page.locator('[data-testid="skillapp-ui"]')

  // 最初应该在「初始化应用中」状态
  const progressText1 = await progressBar.textContent()
  expect(progressText1).toContain('初始化应用中')

  // 15 秒后，进度条消失，SkillApp 内容显示（可能仍在加载）
  await expect
    .poll(async () => {
      try {
        return await skillAppUI.isVisible()
      } catch {
        return false
      }
    }, { timeout: 20000 })  // poll 超时设为 20s > 15s 降级阈值
    .toBe(true)

  // 5. 验证 SkillApp 最终可用（或显示加载中）
  const appContent = await page.locator('[data-testid="app-content"]')
  // 可能显示 loading spinner，但不应该卡死或显示错误
  const isLoading = await page.locator('[data-testid="loading-spinner"]').isVisible()
  const isContent = await appContent.isVisible()

  expect(isLoading || isContent).toBe(true)  // 至少一个应该可见
})
```

---

## 7. 测试套件 5：离线/重连（reconnect.spec.ts）

**覆盖**：AI Provider 离线提示、重连、API Key 无效

### 7.1 测试用例：AI Provider 离线时的 UI 提示

**Given**：
- Desktop 已运行，Claude Stub 正常
- 状态栏指示灯为绿色

**When**：
```typescript
test('ai provider offline ui indicator', async ({ page }) => {
  // 1. 启动 Desktop（Claude Stub 在线）
  // 验证状态栏指示灯为绿色
  const statusIndicator = await page.locator('[data-testid="provider-status-indicator"]')
  let bgColor = await statusIndicator.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor
  })
  expect(bgColor).toMatch(/rgb\(0, 128, 0/)  // 绿色

  // 2. 停止 Claude Stub（模拟离线）
  const mockServer = new MockServer()
  await mockServer.stop()
```

**Then**：
```typescript
  // 3. 验证状态栏指示灯变红（使用 poll 等待）
  await expect
    .poll(async () => {
      const bgColor = await statusIndicator.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor
      })
      // 等待变红 rgb(255, 0, 0)
      return bgColor.includes('255, 0')
    }, { timeout: 5000 })
    .toBe(true)

  // 4. 尝试触发生成，验证显示「AI Provider 不可用」提示
  await page.click('[data-testid="btn-new-app"]')
  // ... 选择 Skill、输入意图 ...
  await page.click('[data-testid="btn-next-to-plan"]')

  // 等待显示错误提示
  const errorMsg = await page.locator('[data-testid="error-message"]')
  await expect(errorMsg).toContainText('AI Provider 不可用')
  await expect(errorMsg).toContainText('请检查网络连接或配置')
})
```

### 7.2 测试用例：AI Provider 重连

**Given**：
- Claude Stub 已停止（离线）
- 状态栏指示灯为红色

**When**：
```typescript
test('ai provider reconnection', async ({ page }) => {
  // 1. Claude Stub 已停止（前一测试的状态）
  const statusIndicator = await page.locator('[data-testid="provider-status-indicator"]')

  // 2. 重新启动 Claude Stub
  const mockServer = new MockServer()
  const { port } = await mockServer.start()
  console.log(`Claude Stub restarted on port ${port}`)
```

**Then**：
```typescript
  // 3. 验证 Desktop 自动检测到 Provider 恢复，指示灯变绿
  await expect
    .poll(async () => {
      const bgColor = await statusIndicator.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor
      })
      // 等待变绿 rgb(0, 128, 0)
      return bgColor.includes('0, 128')
    }, { timeout: 10000 })
    .toBe(true)

  // 4. 现在可以正常触发生成
  await page.click('[data-testid="btn-new-app"]')
  // ... 前述步骤 ...
  await page.click('[data-testid="btn-next-to-plan"]')

  // 验证规划开始（不显示错误）
  const planDisplay = await page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).toBeVisible({ timeout: 10000 })
})
```

### 7.3 测试用例：API Key 无效

**Given**：
- Desktop 已启动
- 配置了无效的 API Key

**When**：
```typescript
test('invalid api key error handling', async ({ page }) => {
  // 1. 打开设置页面
  await page.click('[data-testid="nav-settings"]')

  // 2. 清除现有 API Key，输入无效 Key
  const apiKeyInput = await page.locator('[data-testid="api-key-input"]')
  await apiKeyInput.clear()
  await apiKeyInput.fill('invalid-key-12345')

  // 3. 点击「测试连接」
  await page.click('[data-testid="btn-test-connection"]')
```

**Then**：
```typescript
  // 4. 验证设置页面显示「API Key 无效」红色错误
  const errorStatus = await page.locator('[data-testid="connection-status"]')

  await expect(errorStatus).toContainText('API Key 无效', { timeout: 5000 })

  // 验证颜色为红色
  const color = await errorStatus.evaluate((el) => {
    return window.getComputedStyle(el).color
  })
  expect(color).toMatch(/rgb\(255, 0/)  // 红色

  // 5. 尝试生成应该被阻止，显示错误提示
  await page.click('[data-testid="btn-new-app"]')
  // ... 前述步骤 ...

  const errorMsg = await page.locator('[data-testid="error-message"]')
  await expect(errorMsg).toContainText('API Key 配置有误')
})
```

---

## 8. 公共测试辅助函数规范

**文件路径**：`tests/e2e/helpers/`

### 8.1 setupTestApp

```typescript
async function setupTestApp(): Promise<{
  app: ElectronApplication
  page: Page
}> {
  // 1. 启动 Electron 应用
  const app = await electron.launch({
    args: ['--disable-gpu'],
  })

  // 2. 获取首个窗口
  const page = await app.firstWindow()

  // 3. 等待 Desktop 完全加载
  await page.waitForSelector('[data-testid="sidebar"]', { timeout: 10000 })

  // 4. 配置测试 API Key（从 localStorage 或通过 API 调用）
  await page.evaluate(() => {
    window.localStorage.setItem('apiKey', 'test-key')
  })

  return { app, page }
}
```

### 8.2 registerTestSkill

```typescript
async function registerTestSkill(
  page: Page,
  skillDir: string
): Promise<void> {
  // 1. 打开 Skill 管理中心
  await page.click('[data-testid="nav-skills"]')

  // 2. 打开「注册 Skill」对话框
  await page.click('[data-testid="btn-register-skill"]')

  // 3. 输入 Skill 目录路径
  const pathInput = await page.locator('[data-testid="register-dialog"] input')
  await pathInput.fill(skillDir)

  // 4. 点击「注册」
  await page.locator('[data-testid="register-dialog"] [data-testid="btn-confirm"]').click()

  // 5. 等待注册完成
  const skillList = await page.locator('[data-testid="skill-list"]')
  await expect(skillList).toContainText(path.basename(skillDir), { timeout: 5000 })
}
```

### 8.3 waitForMorphingComplete

```typescript
async function waitForMorphingComplete(
  page: Page,
  timeout: number = 15000
): Promise<void> {
  // 1. 等待 SkillApp UI 出现（表示原地变形完成）
  const skillAppUI = await page.locator('[data-testid="skillapp-ui"]')

  await expect
    .poll(async () => {
      return await skillAppUI.isVisible()
    }, { timeout })
    .toBe(true)

  // 2. 验证应用首屏内容加载
  const appContent = await page.locator('[data-testid="app-main-content"]')
  await expect(appContent).toBeVisible({ timeout: 5000 })
}
```

### 8.4 takeScreenshotWithTimestamp

```typescript
async function takeScreenshotWithTimestamp(
  page: Page,
  name: string
): Promise<void> {
  // 1. 生成带时间戳的文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `${name}-${timestamp}.png`
  const filepath = path.join(
    process.cwd(),
    'test-reports/e2e/screenshots',
    filename
  )

  // 2. 创建目录（如果不存在）
  await fs.promises.mkdir(path.dirname(filepath), { recursive: true })

  // 3. 截图
  await page.screenshot({ path: filepath })

  console.log(`Screenshot saved: ${filepath}`)
}
```

### 8.5 stubScenario

```typescript
async function stubScenario(
  server: MockServer,
  scenario: string
): Promise<void> {
  // 1. 调用 Mock Server 控制接口
  await server.setScenario(scenario as StubScenario)

  // 2. 等待配置生效（可选，根据 Stub 实现）
  await new Promise(resolve => setTimeout(resolve, 100))
}
```

---

## 9. CI 配置

**文件路径**：`.github/workflows/e2e-tests.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  e2e:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
        node-version: [20.x]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Build app
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          CI: true
          ANTHROPIC_BASE_URL: http://localhost:3001

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-results-${{ matrix.os }}
          path: test-reports/e2e/
          retention-days: 30

      - name: Upload screenshots on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-screenshots-${{ matrix.os }}
          path: test-reports/e2e/screenshots/
          retention-days: 7
```

**测试命令**：
```bash
npm run test:e2e
```

**超时配置**：
- 单个测试：60 秒（生成流程耗时）
- 断言（expect）：5 秒
- poll 轮询：10-20 秒（根据流程需要）

**失败重试**：
- 本地开发：无重试
- CI 环境：失败重试 2 次（由 `playwright.config.ts` 配置）

**截图存档**：
- 路径：`test-reports/e2e/screenshots/`
- 时机：失败时自动截图；关键步骤（原地变形前后）手动截图
- 保留时间：CI artifacts 保留 30 天

---

## 10. 测试数据

### 10.1 测试用 Skill 目录

**目录结构**：

```
tests/fixtures/skills/
├── test-skill-a/
│   ├── skill.json
│   ├── package.json
│   └── lib/
│       └── index.ts
└── test-skill-b/
    ├── skill.json
    ├── package.json
    └── lib/
        └── index.ts
```

**test-skill-a/skill.json**（符合 M-02 规范）：

```json
{
  "id": "test-skill-a",
  "name": "Test Skill A",
  "version": "1.0.0",
  "description": "数据处理工具",
  "author": "IntentOS Test Team",
  "methods": [
    {
      "name": "processData",
      "description": "处理数据",
      "params": [
        { "name": "input", "type": "string", "description": "输入数据" }
      ],
      "return": { "type": "object", "description": "处理结果" }
    }
  ],
  "dependencies": [],
  "permissions": ["fs.read", "fs.write"]
}
```

**test-skill-b/skill.json**：

```json
{
  "id": "test-skill-b",
  "name": "Test Skill B",
  "version": "1.0.0",
  "description": "导出工具",
  "author": "IntentOS Test Team",
  "methods": [
    {
      "name": "exportToCSV",
      "description": "导出为 CSV",
      "params": [
        { "name": "data", "type": "array", "description": "数据数组" }
      ],
      "return": { "type": "string", "description": "CSV 文件路径" }
    }
  ],
  "dependencies": [],
  "permissions": ["fs.write", "process.spawn"]
}
```

### 10.2 skill.json 格式要求

必须符合 M-02 Skill 管理器规范：
- `id`、`name`、`version`、`description` 必须
- `methods` 数组包含所有公开方法
- 每个 method 包含 `name`、`description`、`params`、`return`
- `dependencies` 可为空数组
- `permissions` 列出所需的系统权限

---

## 11. 测试执行清单

执行 E2E 测试前，确认以下事项：

- [ ] Claude Stub 已启动（或配置自动启动）
- [ ] `ANTHROPIC_BASE_URL=http://localhost:3001` 已设置
- [ ] `tests/fixtures/skills/` 目录已创建，包含 `test-skill-a/` 和 `test-skill-b/`
- [ ] 每个 test-skill 目录下都有合法的 `skill.json`
- [ ] `test-reports/e2e/screenshots/` 目录存在（或会自动创建）
- [ ] Playwright browsers 已安装：`npx playwright install`
- [ ] 项目已构建：`npm run build`

**运行测试**：

```bash
# 全部 E2E 测试
npm run test:e2e

# 单个测试套件
npm run test:e2e -- generation-flow.spec.ts

# 单个测试用例
npm run test:e2e -- generation-flow.spec.ts -g "正常生成流程"

# 调试模式
npm run test:e2e -- --debug

# 生成 HTML 报告
npm run test:e2e -- --reporter=html
```

---

## 12. 已知限制与备注

1. **Linux 合成器检测**：Linux 上 opacity 动画依赖 X11 合成器（如 Xfce、KDE Plasma）支持。轻量级 WM（i3、dwm）不支持时，原地变形降级为方案 B（直接切换）。

2. **Electron 版本**：测试基于 Electron v33.x。若升级 Electron 版本，需验证 `BrowserWindow.setOpacity()`、`utilityProcess.fork()` 等 API 兼容性。

3. **Mock Server 精度**：Claude Stub 的流式延迟注入（`MOCK_LATENCY`）基于 `setTimeout`，精度约 ±50ms。

4. **跨平台差异**：
   - macOS：原地变形 Phase 2（淡入淡出）最优体验
   - Windows：DWM 合成器可能引入额外延迟
   - Linux：无合成器时自动降级为方案 B

5. **内存泄漏检测**：热更新测试中的内存泄漏检测依赖 `process.memoryUsage()`，精度有限。建议配合 Chromium DevTools 手动验证。

---

## 13. 测试报告示例

测试完成后，reports 目录结构如下：

```
test-reports/
├── e2e/
│   ├── index.html                    # Playwright HTML 报告
│   ├── results.json                  # 测试结果 JSON
│   ├── junit.xml                     # JUnit XML（CI 集成）
│   └── screenshots/
│       ├── generation-before-morph.png
│       ├── generation-after-morph.png
│       └── ... (其他截图)
├── unit/
│   └── coverage/                     # Vitest 覆盖率
└── generation-quality/               # 生成质量评估（Iter 6）
```

---

**文档完成日期**：2026-03-13
**下一步**：test-engineer agent 在 Iter 6 中实现本规范定义的完整 E2E 测试套件。
