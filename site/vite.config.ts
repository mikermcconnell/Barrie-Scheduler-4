import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained HTML file (scripts, styles and fonts inlined)
// so the dashboard opens straight from disk with no server or internet.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    // Plain JavaScript that every current browser (and ones back to 2019) can run.
    target: ['es2019', 'chrome79', 'edge79', 'firefox72', 'safari13'],
    modulePreload: false,
  },
  server: { port: 3010 },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
