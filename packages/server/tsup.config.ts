import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts', 'src/seed.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  // workspace packages export source TS, so they must be compiled into the bundle
  noExternal: [/^@smokejumper\//],
  // everything else stays external (incl. transitive deps like @mastra/core, whose CJS
  // dep gray-matter would break the ESM bundle) — resolved at runtime from the hoisted
  // prod node_modules. noExternal above wins over this, so @smokejumper/* is still bundled.
  external: [/^[^./]/],
})
