import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000, // 30s for tests that launch browsers
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist/**', 'node_modules/**', 'test/**', '**/*.spec.ts', '**/*.test.ts'],
    },
  },
})
