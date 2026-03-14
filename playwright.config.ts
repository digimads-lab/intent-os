import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  reporter: [['html', { outputFolder: 'test-reports/e2e' }]],
  use: {
    trace: 'on-first-retry',
  },
  // No projects/browser devices — e2e tests use _electron.launch() directly
})
