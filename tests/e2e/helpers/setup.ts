import * as path from 'path'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

export interface TestApp {
  app: ElectronApplication
  page: Page
}

// ---------------------------------------------------------------------------
// setupTestApp
// Launches the Electron app, waits for the sidebar to load, injects a test
// API key and returns the handles for use in test suites.
// ---------------------------------------------------------------------------
export async function setupTestApp(): Promise<TestApp> {
  // Resolve the built app entry point relative to the project root.
  // electron-vite outputs to out/main/index.js by default.
  const appPath = path.resolve(__dirname, '..', '..', '..', 'out', 'main', 'index.js')

  const app = await electron.launch({
    args: [appPath, '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'] ?? 'http://localhost:3001',
    },
  })

  const page = await app.firstWindow()

  // Wait for the renderer to fully paint the sidebar before any test logic runs
  await page.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 })

  // Inject the test API key so the stub accepts requests
  await page.evaluate(() => {
    window.localStorage.setItem('apiKey', 'test-key-from-stub')
  })

  return { app, page }
}

// ---------------------------------------------------------------------------
// registerTestSkill
// Opens the Skill management centre and registers a local skill directory.
// ---------------------------------------------------------------------------
export async function registerTestSkill(page: Page, skillDir: string): Promise<void> {
  await page.click('[data-testid="nav-skills"]')
  await page.click('[data-testid="btn-register-skill"]')

  const pathInput = page.locator('[data-testid="register-dialog"] input')
  await pathInput.fill(skillDir)

  await page.locator('[data-testid="register-dialog"] [data-testid="btn-confirm"]').click()

  // Wait until the registered skill name appears in the list
  const skillList = page.locator('[data-testid="skill-list"]')
  const { expect } = await import('@playwright/test')
  await expect(skillList).toContainText(path.basename(skillDir), { timeout: 5000 })
}

// ---------------------------------------------------------------------------
// Fixture paths (re-exported for convenience in spec files)
// ---------------------------------------------------------------------------
export const FIXTURE_SKILL_A_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'skills',
  'test-skill-a',
)

export const FIXTURE_SKILL_B_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'skills',
  'test-skill-b',
)
