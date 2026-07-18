import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { weaselAliases } from '../weasel/scripts/vite-aliases';

const weaselRoot = resolve(__dirname, '../weasel');

export default defineConfig({
  // Served from https://orochi235.github.io/lbx-editor/ on Pages; root locally.
  base: process.env.GITHUB_ACTIONS ? '/lbx-editor/' : '/',
  plugins: [react()],
  resolve: {
    alias: weaselAliases(weaselRoot, [
      // bil-lbx local source
      {
        find: 'bil-lbx',
        replacement: resolve(__dirname, '../bil-lbx/src/index.ts'),
      },
      // obwat local source
      {
        find: 'obwat',
        replacement: resolve(__dirname, '../obwat/src/index.ts'),
      },
    ]),
  },
  server: { port: 5180 },
});
