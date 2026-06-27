import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/serve-shop-api.ts',
    'src/serve-worker.ts',
    'src/serve-watchdog.ts',
    'src/chaos.ts',
    'src/seed-demo.ts',
  ],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/^@smokejumper\//],
})
