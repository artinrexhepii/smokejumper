import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts', 'src/seed.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  // workspace packages export source TS, so they must be compiled into the bundle
  noExternal: [/^@smokejumper\//],
})
