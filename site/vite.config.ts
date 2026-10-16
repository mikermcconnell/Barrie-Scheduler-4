import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained HTML file (scripts, styles and fonts inlined)
// so the dashboard opens straight from disk with no server or internet.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  server: { port: 3010 },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
