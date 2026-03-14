import * as path from 'path'
import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { MockServer } from './helpers/mock-server'
import { FIXTURE_SKILL_A_DIR } from './helpers/setup'

// ---------------------------------------------------------------------------
// Suite setup — one app instance shared across all tests in this file.
// The suite bootstraps a fresh app and runs a full generation so that a
// SkillApp is available for modification tests.
// ---------------------------------------------------------------------------

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const appPath = path.resolve(__dirname, '..', '..', 'out', 'main', 'index.js')

  electronApp = await electron.launch({
    args: [appPath, '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'] ?? 'http://localhost:3001',
    },
  })

  page = await electronApp.firstWindow()
  await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 })
  await page.evaluate(() => {
    window.localStorage.setItem('apiKey', 'test-key-from-stub')
  })

  // Register skill and generate a base app so modification tests have something to work with
  await _registerSkill(page, FIXTURE_SKILL_A_DIR)
  await _generateBaseApp(page)
})

test.afterAll(async () => {
  await electronApp.close()
})

async function _registerSkill(p: Page, skillDir: string): Promise<void> {
  await p.click('[data-testid="nav-skills"]')
  await p.click('[data-testid="btn-register-skill"]')
  const pathInput = p.locator('[data-testid="register-dialog"] input')
  await pathInput.fill(skillDir)
  await p.locator('[data-testid="register-dialog"] [data-testid="btn-confirm"]').click()
  await expect(p.locator('[data-testid="skill-list"]')).toContainText(
    path.basename(skillDir),
    { timeout: 5000 },
  )
}

async function _generateBaseApp(p: Page): Promise<void> {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  await p.click('[data-testid="btn-new-app"]')
  await expect(p.locator('[data-testid="generation-window"]')).toBeVisible()
  await p.click('[data-testid="skill-checkbox-test-skill-a"]')
  await p.fill('[data-testid="intent-input"]', '创建一个待办事项管理应用')
  await p.click('[data-testid="btn-next-to-plan"]')

  // Wait for plan
  await expect
    .poll(
      async () => (await p.locator('[data-testid="plan-display"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)

  await p.click('[data-testid="btn-confirm-generate"]')

  // Wait for generation to complete and morphing to finish
  await expect
    .poll(
      async () => {
        const text = await p.locator('[data-testid="progress-bar"]').textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 30000 },
    )
    .toBe(true)

  await expect
    .poll(async () => p.locator('[data-testid="skillapp-ui"]').isVisible(), { timeout: 15000 })
    .toBe(true)
}

// ---------------------------------------------------------------------------
// 4.1  end-to-end modification flow: intent → incremental plan → hot update
// ---------------------------------------------------------------------------
test('end-to-end modification flow: intent → incremental plan → hot update', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  // Pre-condition: populate the SkillApp with user data
  const todoInput = page.locator('[data-testid="todo-input"]')
  await todoInput.fill('完成 E2E 测试')
  await page.click('[data-testid="btn-add-todo"]')

  const todoList = page.locator('[data-testid="todo-list"]')
  await expect(todoList).toContainText('完成 E2E 测试')

  // Open modification wizard
  await page.click('[data-testid="btn-modify-app"]')
  const modifyWindow = page.locator('[data-testid="modification-window"]')
  await expect(modifyWindow).toBeVisible()

  // Enter modification requirement
  const intentInput = page.locator('[data-testid="modify-intent-input"]')
  await intentInput.fill('改变主题颜色为深色模式')
  await page.click('[data-testid="btn-generate-plan"]')

  // Incremental diff view loads
  const diffView = page.locator('[data-testid="diff-view"]')
  await expect(diffView).toBeVisible()

  await expect
    .poll(
      async () => {
        const content = await diffView.textContent()
        return content?.includes('ThemeProvider') ?? false
      },
      { timeout: 10000 },
    )
    .toBe(true)

  // All three diff categories are displayed
  await expect(page.locator('[data-testid="diff-added"]')).toBeVisible()
  await expect(page.locator('[data-testid="diff-modified"]')).toBeVisible()
  await expect(page.locator('[data-testid="diff-unchanged"]')).toBeVisible()

  // Confirm hot update
  await page.click('[data-testid="btn-confirm-update"]')

  // Progress bar reaches 100 %
  const updateProgress = page.locator('[data-testid="update-progress"]')
  await expect(updateProgress).toBeVisible()
  await expect
    .poll(
      async () => {
        const text = await updateProgress.textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 15000 },
    )
    .toBe(true)

  // Modification window closes
  await expect(modifyWindow).not.toBeVisible()

  // SkillApp regains focus
  const appUI = page.locator('[data-testid="skillapp-ui"]')
  await expect(appUI).toBeFocused()

  // Dark-mode background is applied (R/G/B values are all low for a dark colour)
  const themeStyle = await page.locator('html').evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor
  })
  expect(themeStyle).toMatch(/rgb\((2\d|[1-9]|0),/)

  // Pre-existing todo data is preserved
  await expect(page.locator('[data-testid="todo-list"]')).toContainText('完成 E2E 测试')
})

// ---------------------------------------------------------------------------
// 4.2  hot update rollback on crash
// ---------------------------------------------------------------------------
test('hot update rollback on crash', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('crash-on-render')

  await page.click('[data-testid="btn-modify-app"]')
  await expect(page.locator('[data-testid="modification-window"]')).toBeVisible()

  const intentInput = page.locator('[data-testid="modify-intent-input"]')
  await intentInput.fill('触发崩溃场景')
  await page.click('[data-testid="btn-generate-plan"]')

  // Wait for plan diff then confirm update
  await expect
    .poll(
      async () => (await page.locator('[data-testid="diff-view"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)
  await page.click('[data-testid="btn-confirm-update"]')

  // Update progresses to 100 %
  const updateProgress = page.locator('[data-testid="update-progress"]')
  await expect
    .poll(
      async () => {
        const text = await updateProgress.textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 10000 },
    )
    .toBe(true)

  // SkillApp crashes — error boundary appears
  const errorBoundary = page.locator('[data-testid="error-boundary"]')
  await expect(errorBoundary).toBeVisible({ timeout: 5000 })

  // Lifecycle manager detects crash and triggers rollback — loading spinner shows
  const loadingSpinner = page.locator('[data-testid="loading-spinner"]')
  await expect(loadingSpinner).toBeVisible()

  // App recovers and SkillApp UI is visible again
  await expect
    .poll(async () => page.locator('[data-testid="skillapp-ui"]').isVisible(), { timeout: 10000 })
    .toBe(true)

  // Rollback notification is shown
  const rollbackNotification = page.locator('[data-testid="rollback-notification"]')
  await expect(rollbackNotification).toContainText('已回滚到修改前版本')
})

// ---------------------------------------------------------------------------
// 4.3  user state preservation after hot update
// ---------------------------------------------------------------------------
test('user state preservation after hot update', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  // Populate complex form data in SkillApp
  const form = page.locator('[data-testid="form"]')
  await form.locator('input[name="title"]').fill('项目名称')
  await form.locator('input[name="description"]').fill('详细描述...')

  // Confirm Zustand store has the data
  const initialState = await page.evaluate(() => {
    return (window as unknown as { __zustandStore?: { getState?: () => Record<string, unknown> } }).__zustandStore?.getState?.()
  })
  expect(initialState?.['title']).toBe('项目名称')

  // Trigger hot update
  await page.click('[data-testid="btn-modify-app"]')
  await expect(page.locator('[data-testid="modification-window"]')).toBeVisible()

  const intentInput = page.locator('[data-testid="modify-intent-input"]')
  await intentInput.fill('小幅调整按钮样式')
  await page.click('[data-testid="btn-generate-plan"]')

  await expect
    .poll(
      async () => (await page.locator('[data-testid="diff-view"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)
  await page.click('[data-testid="btn-confirm-update"]')

  // Wait for completion
  await expect
    .poll(
      async () => {
        const text = await page.locator('[data-testid="update-progress"]').textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 10000 },
    )
    .toBe(true)

  // Zustand store state is still intact after hot update
  const finalState = await page.evaluate(() => {
    return (window as unknown as { __zustandStore?: { getState?: () => Record<string, unknown> } }).__zustandStore?.getState?.()
  })
  expect(finalState?.['title']).toBe('项目名称')
  expect(finalState?.['description']).toBe('详细描述...')

  // UI layer also reflects the preserved state
  const titleInput = page.locator('input[name="title"]')
  const titleValue = await titleInput.inputValue()
  expect(titleValue).toBe('项目名称')
})
