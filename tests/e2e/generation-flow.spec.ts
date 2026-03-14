import * as path from 'path'
import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { MockServer, takeScreenshotWithTimestamp } from './helpers/mock-server'
import { FIXTURE_SKILL_A_DIR, FIXTURE_SKILL_B_DIR } from './helpers/setup'

// ---------------------------------------------------------------------------
// Suite setup — one app instance shared across all tests in this file
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

  // Pre-register the two test skills needed by generation tests
  await _registerSkill(page, FIXTURE_SKILL_A_DIR)
  await _registerSkill(page, FIXTURE_SKILL_B_DIR)
})

test.afterAll(async () => {
  await electronApp.close()
})

// ---------------------------------------------------------------------------
// Internal helper — register a skill without navigating away from current page
// (only used in beforeAll; tests that need skill navigation use the nav approach)
// ---------------------------------------------------------------------------
async function _registerSkill(p: Page, skillDir: string): Promise<void> {
  await p.click('[data-testid="nav-skills"]')
  await p.click('[data-testid="btn-register-skill"]')
  const pathInput = p.locator('[data-testid="register-dialog"] input')
  await pathInput.fill(skillDir)
  await p.locator('[data-testid="register-dialog"] [data-testid="btn-confirm"]').click()
  // Wait for the skill name to appear — confirms registration completed
  await expect(p.locator('[data-testid="skill-list"]')).toContainText(
    path.basename(skillDir),
    { timeout: 5000 },
  )
}

// ---------------------------------------------------------------------------
// 3.1  end-to-end generation flow: intent → plan → generate → morph
// ---------------------------------------------------------------------------
test('end-to-end generation flow: intent → plan → generate → morph', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  // Step 1 — open the new-app wizard
  await page.click('[data-testid="btn-new-app"]')

  // Step 2 — generation window (phase 1) is visible
  const generationWindow = page.locator('[data-testid="generation-window"]')
  await expect(generationWindow).toBeVisible()

  // Step 3 — select both test skills
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.click('[data-testid="skill-checkbox-test-skill-b"]')

  // Step 4 — enter intent
  await page.fill('[data-testid="intent-input"]', '创建一个待办事项管理应用')

  // Step 5 — advance to planning phase
  await page.click('[data-testid="btn-next-to-plan"]')

  // Step 6 — plan display is visible and streaming chunks arrive
  const planDisplay = page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).toBeVisible()

  await expect
    .poll(
      async () => {
        const text = await planDisplay.textContent()
        return text?.split('\n').length ?? 0
      },
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(8)

  // Step 7 — final PlanResult contains expected sections
  const planResult = page.locator('[data-testid="plan-result"]')
  await expect(planResult).toContainText('应用架构')
  await expect(planResult).toContainText('页面设计')

  // Screenshot before generation starts
  await takeScreenshotWithTimestamp(page, 'generation-before-generate')

  // Step 8 — confirm and start code generation
  await page.click('[data-testid="btn-confirm-generate"]')

  // Step 9 — progress bar advances to 100 %
  const progressBar = page.locator('[data-testid="progress-bar"]')
  await expect
    .poll(
      async () => {
        const text = await progressBar.textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 30000 },
    )
    .toBe(true)

  // Screenshot just before morph
  await takeScreenshotWithTimestamp(page, 'generation-before-morph')

  // Step 10 — morphing completes: SkillApp UI becomes visible
  const skillAppUI = page.locator('[data-testid="skillapp-ui"]')
  await expect
    .poll(async () => skillAppUI.isVisible(), { timeout: 15000 })
    .toBe(true)

  // Screenshot after morph
  await takeScreenshotWithTimestamp(page, 'generation-after-morph')

  // Step 11 — SkillApp title contains the intent keyword
  const windowTitle = await page.title()
  expect(windowTitle).toContain('待办事项')

  // Step 12 — first-paint main content is visible
  const appContent = page.locator('[data-testid="app-main-content"]')
  await expect(appContent).toBeVisible({ timeout: 5000 })
})

// ---------------------------------------------------------------------------
// 3.2  multi-round planning interaction
// ---------------------------------------------------------------------------
test('multi-round planning interaction', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  // Navigate to planning phase
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.fill('[data-testid="intent-input"]', '创建一个待办事项管理应用')
  await page.click('[data-testid="btn-next-to-plan"]')

  // Wait for initial plan to arrive
  const planDisplay = page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).toBeVisible()
  await expect
    .poll(async () => (await planDisplay.textContent())?.length ?? 0, { timeout: 10000 })
    .toBeGreaterThan(0)

  // Round 2 — request export feature
  const feedbackInput = page.locator('[data-testid="plan-feedback-input"]')
  await feedbackInput.fill('请增加数据导出功能')
  await page.click('[data-testid="btn-replan"]')

  // Streaming update for the revised plan should include export content
  await expect
    .poll(
      async () => {
        const text = await planDisplay.textContent()
        return text?.includes('导出') ?? false
      },
      { timeout: 10000 },
    )
    .toBe(true)

  // Final PlanResult references the new export module
  const planResult = page.locator('[data-testid="plan-result"]')
  const planText = await planResult.textContent()
  expect(planText).toContain('导出模块')
  expect(planText).toContain('ExportService')
})

// ---------------------------------------------------------------------------
// 3.3  generation failure with automatic retry
// ---------------------------------------------------------------------------
test('generation failure with automatic retry', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('compile-error')

  // Open wizard and skip straight to generate
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.fill('[data-testid="intent-input"]', '创建失败测试应用')
  await page.click('[data-testid="btn-next-to-plan"]')

  // Wait for plan then confirm generate
  await expect
    .poll(
      async () => (await page.locator('[data-testid="plan-display"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)
  await page.click('[data-testid="btn-confirm-generate"]')

  // Retry counter messages should appear sequentially
  const errorDisplay = page.locator('[data-testid="error-message"]')
  await expect(errorDisplay).toContainText('编译失败，正在重试（1/3）', { timeout: 10000 })
  await expect(errorDisplay).toContainText('（2/3）', { timeout: 10000 })
  await expect(errorDisplay).toContainText('（3/3）', { timeout: 10000 })

  // After exhausting retries the final failure message appears
  await expect(errorDisplay).toContainText('生成失败', { timeout: 10000 })

  // TypeScript error code is surfaced in the detail area
  const errorDetails = page.locator('[data-testid="error-details"]')
  await expect(errorDetails).toContainText('TS')

  // Recovery buttons are visible
  await expect(page.locator('[data-testid="btn-retry-generation"]')).toBeVisible()
  await expect(page.locator('[data-testid="btn-back-to-plan"]')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 3.4  UI remains responsive under high latency
// ---------------------------------------------------------------------------
test('UI remains responsive under high latency', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setConfig({ latency: 500 })

  // Open wizard and proceed to planning
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.fill('[data-testid="intent-input"]', '高延迟响应测试')
  await page.click('[data-testid="btn-next-to-plan"]')

  // Loading spinner should appear immediately — AI is responding slowly
  const loadingSpinner = page.locator('[data-testid="loading-spinner"]')
  await expect(loadingSpinner).toBeVisible()

  // Cancel button must remain enabled — UI is not blocked
  const btnCancel = page.locator('[data-testid="btn-cancel-plan"]')
  await expect(btnCancel).toBeEnabled()

  // Clicking back must respond immediately (no frozen UI)
  const btnBack = page.locator('[data-testid="btn-back"]')
  await btnBack.click()

  // Plan display should disappear after navigation back
  await expect(page.locator('[data-testid="plan-display"]')).not.toBeVisible({ timeout: 5000 })
})
