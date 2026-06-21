import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { weaselAliases } from '../weasel/scripts/vite-aliases';

const weaselRoot = resolve(__dirname, '../weasel');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: weaselAliases(weaselRoot, [
      // brother-lbx local source
      {
        find: 'brother-lbx',
        replacement: resolve(__dirname, '../brother-lbx/src/index.ts'),
      },
    ]),
  },
  server: { port: 5180 },
});
