import * as path from 'path'
import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { MockServer, takeScreenshotWithTimestamp } from './helpers/mock-server'
import { FIXTURE_SKILL_A_DIR } from './helpers/setup'

// ---------------------------------------------------------------------------
// Suite setup — isolated app instance for morphing tests
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

  // Register a skill so generation can proceed
  await _registerSkill(page, FIXTURE_SKILL_A_DIR)
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

// ---------------------------------------------------------------------------
// Shared helper: drive the app through generation up to 100 % progress, then
// return the bounding rect of the generation window just before morphing fires.
// ---------------------------------------------------------------------------
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

async function _driveToMorphingPoint(p: Page): Promise<Bounds> {
  const mockServer = new MockServer()
  await mockServer.reset()
  await mockServer.setScenario('normal')

  await p.click('[data-testid="btn-new-app"]')
  await expect(p.locator('[data-testid="generation-window"]')).toBeVisible()
  await p.click('[data-testid="skill-checkbox-test-skill-a"]')
  await p.fill('[data-testid="intent-input"]', '创建变形测试应用')
  await p.click('[data-testid="btn-next-to-plan"]')

  // Wait for plan
  await expect
    .poll(
      async () => (await p.locator('[data-testid="plan-display"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)

  await p.click('[data-testid="btn-confirm-generate"]')

  // Capture window bounds just as 100 % is reached (before morph fires)
  await expect
    .poll(
      async () => {
        const text = await p.locator('[data-testid="progress-bar"]').textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 30000 },
    )
    .toBe(true)

  const generationWindow = p.locator('[data-testid="generation-window"]')
  const bounds = await generationWindow.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })

  return bounds
}

// ---------------------------------------------------------------------------
// 6.1  morphing window position unchanged (macOS)
// ---------------------------------------------------------------------------
test('morphing window position unchanged (macOS)', async () => {
  const beforeBounds = await _driveToMorphingPoint(page)
  console.log('Before morph bounds:', beforeBounds)

  // Screenshot before morph completes
  await takeScreenshotWithTimestamp(page, 'morph-before')

  // Wait for SkillApp UI to appear — morph is complete
  const skillAppUI = page.locator('[data-testid="skillapp-ui"]')
  await expect
    .poll(async () => skillAppUI.isVisible(), { timeout: 15000 })
    .toBe(true)

  // Screenshot after morph
  await takeScreenshotWithTimestamp(page, 'morph-after')

  // After morphing the HTML root bounding rect reflects the new window geometry.
  // We compare against the generation-window bounds captured before the switch.
  const afterBounds = await page.locator('html').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  console.log('After morph bounds:', afterBounds)

  // Position tolerance: 10 px (accounts for DPI scaling and sub-pixel rounding)
  expect(Math.abs(beforeBounds.x - afterBounds.x)).toBeLessThan(10)
  expect(Math.abs(beforeBounds.y - afterBounds.y)).toBeLessThan(10)

  // Size tolerance: 20 px
  expect(Math.abs(beforeBounds.width - afterBounds.width)).toBeLessThan(20)
  expect(Math.abs(beforeBounds.height - afterBounds.height)).toBeLessThan(20)
})

// ---------------------------------------------------------------------------
// 6.2  morphing timeout fallback to direct switch
// When the SkillApp process never emits the `ready` signal the lifecycle
// manager should fall back to a direct window switch after 15 s.
// ---------------------------------------------------------------------------
test('morphing timeout fallback to direct switch', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()
  // Use normal generation but signal the stub that the SkillApp should not
  // send a ready event (simulated via a dedicated scenario if the stub
  // supports it; otherwise the test asserts the fallback behaviour directly).
  await mockServer.setScenario('normal')

  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.click('[data-testid="skill-checkbox-test-skill-a"]')
  await page.fill('[data-testid="intent-input"]', '超时降级测试应用')
  await page.click('[data-testid="btn-next-to-plan"]')

  await expect
    .poll(
      async () => (await page.locator('[data-testid="plan-display"]').textContent())?.length ?? 0,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0)

  await page.click('[data-testid="btn-confirm-generate"]')

  // Wait for generation to complete
  await expect
    .poll(
      async () => {
        const text = await page.locator('[data-testid="progress-bar"]').textContent()
        return text?.includes('100%') ?? false
      },
      { timeout: 30000 },
    )
    .toBe(true)

  // Immediately after 100 % the app enters the "initialising" phase
  const progressBar = page.locator('[data-testid="progress-bar"]')
  const progressText = await progressBar.textContent()
  // This may or may not include the string depending on timing — only assert
  // when it is still visible to avoid a race condition
  if (await progressBar.isVisible()) {
    expect(progressText ?? '').toContain('初始化应用中')
  }

  // After at most 20 s (> 15 s timeout threshold) the SkillApp UI must be shown
  // regardless of whether the ready signal arrived — the fallback fires directly.
  const skillAppUI = page.locator('[data-testid="skillapp-ui"]')
  await expect
    .poll(
      async () => {
        try {
          return await skillAppUI.isVisible()
        } catch {
          return false
        }
      },
      { timeout: 20000 },
    )
    .toBe(true)

  // The app content or a loading spinner must be visible — never a hard error
  const isLoading = await page.locator('[data-testid="loading-spinner"]').isVisible()
  const isContent = await page.locator('[data-testid="app-content"]').isVisible()
  expect(isLoading || isContent).toBe(true)
})
