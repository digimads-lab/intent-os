import * as path from 'path'
import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { MockServer } from './helpers/mock-server'

// ---------------------------------------------------------------------------
// Suite setup — isolated app instance for reconnect / provider tests
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
})

test.afterAll(async () => {
  // Ensure stub is back in a clean state for any subsequent test run
  try {
    const mockServer = new MockServer()
    await mockServer.start() // no-op if already running
    await mockServer.reset()
  } catch {
    // Ignore — stub may have been restarted or never stopped
  }
  await electronApp.close()
})

// ---------------------------------------------------------------------------
// 7.1  ai provider offline ui indicator
// ---------------------------------------------------------------------------
test('ai provider offline ui indicator', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()

  // Verify the status indicator is green (provider online) before stopping
  const statusIndicator = page.locator('[data-testid="provider-status-indicator"]')

  await expect
    .poll(
      async () => {
        const bgColor = await statusIndicator.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor
        })
        return bgColor.includes('0, 128') || bgColor.includes('green')
      },
      { timeout: 5000 },
    )
    .toBe(true)

  // Stop the stub to simulate an offline provider
  await mockServer.stop()

  // Status indicator turns red
  await expect
    .poll(
      async () => {
        const bgColor = await statusIndicator.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor
        })
        return bgColor.includes('255, 0') || bgColor.includes('red')
      },
      { timeout: 5000 },
    )
    .toBe(true)

  // Attempting to generate while offline shows an error
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.fill('[data-testid="intent-input"]', '离线测试')
  await page.click('[data-testid="btn-next-to-plan"]')

  const errorMsg = page.locator('[data-testid="error-message"]')
  await expect(errorMsg).toContainText('AI Provider 不可用')
  await expect(errorMsg).toContainText('请检查网络连接或配置')
})

// ---------------------------------------------------------------------------
// 7.2  ai provider reconnection
// NOTE: This test intentionally runs after 7.1 which left the stub stopped.
// ---------------------------------------------------------------------------
test('ai provider reconnection', async () => {
  const mockServer = new MockServer()

  // Restart the stub
  const { port } = await mockServer.start()
  console.log(`Claude Stub restarted on port ${port}`)

  // Desktop should auto-detect that the provider is back — indicator turns green
  const statusIndicator = page.locator('[data-testid="provider-status-indicator"]')
  await expect
    .poll(
      async () => {
        const bgColor = await statusIndicator.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor
        })
        return bgColor.includes('0, 128') || bgColor.includes('green')
      },
      { timeout: 10000 },
    )
    .toBe(true)

  // Generation should now succeed (at least reach the planning stage)
  await mockServer.setScenario('normal')
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.fill('[data-testid="intent-input"]', '重连测试应用')
  await page.click('[data-testid="btn-next-to-plan"]')

  // Plan display appears — no error
  const planDisplay = page.locator('[data-testid="plan-display"]')
  await expect(planDisplay).toBeVisible({ timeout: 10000 })
})

// ---------------------------------------------------------------------------
// 7.3  invalid api key error handling
// ---------------------------------------------------------------------------
test('invalid api key error handling', async () => {
  const mockServer = new MockServer()
  await mockServer.reset()

  // Navigate to settings
  await page.click('[data-testid="nav-settings"]')

  // Replace the API key with an invalid one
  const apiKeyInput = page.locator('[data-testid="api-key-input"]')
  await apiKeyInput.clear()
  await apiKeyInput.fill('invalid-key-12345')

  // Test connection
  await page.click('[data-testid="btn-test-connection"]')

  // Settings page shows a red "API Key 无效" status
  const errorStatus = page.locator('[data-testid="connection-status"]')
  await expect(errorStatus).toContainText('API Key 无效', { timeout: 5000 })

  // The status text must be rendered in red
  const color = await errorStatus.evaluate((el) => {
    return window.getComputedStyle(el).color
  })
  expect(color).toMatch(/rgb\(255, 0/)

  // Attempting to generate with the bad key shows the appropriate error
  await page.click('[data-testid="btn-new-app"]')
  await expect(page.locator('[data-testid="generation-window"]')).toBeVisible()
  await page.fill('[data-testid="intent-input"]', '无效密钥测试')
  await page.click('[data-testid="btn-next-to-plan"]')

  const errorMsg = page.locator('[data-testid="error-message"]')
  await expect(errorMsg).toContainText('API Key 配置有误')

  // Restore a valid key so any subsequent test suite run is not affected
  await page.click('[data-testid="nav-settings"]')
  await apiKeyInput.clear()
  await apiKeyInput.fill('test-key-from-stub')
  await page.click('[data-testid="btn-test-connection"]')
})
