import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { weaselAliases } from '../weasel/scripts/vite-aliases';

const weaselRoot = resolve(__dirname, '../weasel');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: weaselAliases(weaselRoot, [
      // bil-lbx local source
      {
        find: 'bil-lbx',
        replacement: resolve(__dirname, '../bil-lbx/src/index.ts'),
      },
    ]),
  },
  server: { port: 5180 },
});
