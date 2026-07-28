import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Every dependency now resolves from npm, so nothing needs an alias. To develop
// against a sibling checkout, `npm link ../bil-lbx` (or ../weasel, ../obwat) —
// and remember consumers use built `dist/`, so build the sibling after edits.
export default defineConfig({
  // Served from https://orochi235.github.io/lbx-editor/ on Pages; root locally.
  base: process.env.GITHUB_ACTIONS ? '/lbx-editor/' : '/',
  plugins: [react()],
  server: { port: 5180 },
});
