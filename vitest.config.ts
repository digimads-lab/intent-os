import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',  // 主进程测试
    globals: true,
    coverage: {
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'test-reports/coverage',
    },
    include: ['src/**/__tests__/**/*.test.ts', 'packages/**/__tests__/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@intentos/shared-types': path.resolve(__dirname, './packages/shared-types/src/index.ts'),
    },
  },
})
