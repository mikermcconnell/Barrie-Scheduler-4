import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite Configuration
 * 
 * SECURITY NOTE:
 * We removed the API key from here! API keys should NEVER be in frontend code.
 * The Gemini API is now called through our serverless functions in /api/
 * which keeps the key secure on the server.
 */
export default defineConfig({
  server: {
    port: 3008,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
