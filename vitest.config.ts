import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { weaselAliases } from '../weasel/scripts/vite-aliases'

// Tests reach weasel the way the app does — through `weaselAliases()`. Leaving
// it to node_modules resolution worked only while `@weasel-js/core` was
// weasel's root package; once core moved under `packages/`, the linked root
// stopped being a package with an entry at all.
export default defineConfig({
  resolve: {
    alias: weaselAliases(resolve(__dirname, '../weasel'), [
      { find: 'bil-lbx', replacement: resolve(__dirname, '../bil-lbx/src/index.ts') },
    ]),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
