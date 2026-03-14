import * as fs from 'fs'
import * as path from 'path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export type StubScenario = 'normal' | 'compile-error' | 'rate-limit' | 'network-error' | 'crash-on-render'

export interface StubConfig {
  latency?: number
  errorRate?: number
  scenario?: StubScenario
}

export class MockServer {
  private baseUrl: string = 'http://localhost:3001'

  async start(): Promise<{ port: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      if (!response.ok) {
        throw new Error(`Health check returned ${response.status}`)
      }
      return { port: 3001 }
    } catch {
      throw new Error('Claude Stub failed to start or is not reachable')
    }
  }

  async stop(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/shutdown`, { method: 'POST' })
    } catch {
      // Stub may have already stopped — that is fine
    }
  }

  async setScenario(scenario: StubScenario): Promise<void> {
    const response = await fetch(`${this.baseUrl}/stub/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
    })
    if (!response.ok) {
      throw new Error(`setScenario failed: ${response.status}`)
    }
  }

  async setConfig(config: StubConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/stub/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!response.ok) {
      throw new Error(`setConfig failed: ${response.status}`)
    }
  }

  async reset(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/stub/reset`, { method: 'POST' })
    if (!response.ok) {
      throw new Error(`reset failed: ${response.status}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: waitForMorphingComplete
// Polls until the SkillApp UI is visible, indicating morphing has finished.
// ---------------------------------------------------------------------------
export async function waitForMorphingComplete(
  page: Page,
  timeout: number = 15000,
): Promise<void> {
  const skillAppUI = page.locator('[data-testid="skillapp-ui"]')

  await expect
    .poll(
      async () => {
        return skillAppUI.isVisible()
      },
      { timeout },
    )
    .toBe(true)

  // Also wait for main content to confirm first-paint is done
  const appContent = page.locator('[data-testid="app-main-content"]')
  await expect(appContent).toBeVisible({ timeout: 5000 })
}

// ---------------------------------------------------------------------------
// Helper: takeScreenshotWithTimestamp
// Saves a PNG to test-reports/e2e/screenshots/ with an ISO timestamp suffix.
// ---------------------------------------------------------------------------
export async function takeScreenshotWithTimestamp(
  page: Page,
  name: string,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `${name}-${timestamp}.png`
  const filepath = path.join(process.cwd(), 'test-reports', 'e2e', 'screenshots', filename)

  await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
  await page.screenshot({ path: filepath })

  console.log(`Screenshot saved: ${filepath}`)
}
