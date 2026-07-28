import { defineConfig } from 'vitest/config'

// bil-lbx, weasel and obwat all come from npm, so node resolution finds them
// without help and no aliases are needed here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
