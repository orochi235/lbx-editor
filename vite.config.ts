import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // Served from https://orochi235.github.io/lbx-editor/ on Pages; root locally.
  base: process.env.GITHUB_ACTIONS ? '/lbx-editor/' : '/',
  plugins: [react()],
  resolve: {
    alias: [
      // bil-lbx local source. (weasel and obwat resolve to their published
      // packages — `npm link ../weasel` or `../obwat` to develop against the
      // editor, and remember both consumers use built `dist/`.)
      {
        find: 'bil-lbx',
        replacement: resolve(__dirname, '../bil-lbx/src/index.ts'),
      },
    ],
  },
  server: { port: 5180 },
});
