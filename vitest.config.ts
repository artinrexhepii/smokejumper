import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'plugins/*/test/**/*.test.ts',
      'demo/test/**/*.test.ts',
    ],
  },
})
