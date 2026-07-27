import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// bil-lbx is the one dependency still resolved from a sibling checkout; weasel
// and obwat come from npm, so node resolution finds them without help.
export default defineConfig({
  resolve: {
    alias: [
      { find: 'bil-lbx', replacement: resolve(__dirname, '../bil-lbx/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
