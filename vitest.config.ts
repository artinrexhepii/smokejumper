import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'plugins/*/test/**/*.test.ts',
      'demo/test/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
