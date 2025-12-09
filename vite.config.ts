import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { optimizeImplementation } from './api/optimize';

/**
 * Vite Configuration
 */
console.log('✅ vite.config.ts is loading...');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  console.log('✅ defineConfig called');

  // Define API Middleware Plugin
  const apiMiddlewarePlugin = () => ({
    name: 'configure-server',
    configureServer(server) {
      console.log('✅ Plugin configureServer called');
      server.middlewares.use(async (req, res, next) => {
        console.log('Incoming request:', req.method, req.url);

        if (req.url === '/api/optimize' && req.method === 'POST') {
          try {
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyString = Buffer.concat(buffers).toString();

            if (!bodyString) {
              throw new Error('Empty request body');
            }

            const data = JSON.parse(bodyString);
            const apiKey = env.GEMINI_API_KEY;

            if (!apiKey) {
              console.error('Missing GEMINI_API_KEY');
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing API Key' }));
              return;
            }

            console.log('🚀 Processing optimization request for', data.mode);
            const { requirements, mode, currentShifts } = data;

            const shifts = await optimizeImplementation(requirements, apiKey, mode, currentShifts);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ shifts }));

          } catch (error: any) {
            console.error('❌ API Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
          }
          return;
        }

        if (req.url === '/api/download-file' && req.method === 'POST') {
          try {
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyString = Buffer.concat(buffers).toString();

            if (!bodyString) {
              throw new Error('Empty request body');
            }

            const { downloadUrl, format = 'text' } = JSON.parse(bodyString);

            if (!downloadUrl) {
              throw new Error('Missing downloadUrl');
            }

            console.log('🔄 Proxying file download:', downloadUrl, 'Format:', format);
            const response = await fetch(downloadUrl);

            if (!response.ok) {
              throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }

            let content;
            if (format === 'base64') {
              const arrayBuffer = await response.arrayBuffer();
              content = Buffer.from(arrayBuffer).toString('base64');
            } else {
              content = await response.text();
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, content, format }));

          } catch (error: any) {
            console.error('❌ Proxy Download Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to download file', details: error.message }));
          }
          return;
        }

        next();
      });
    },
  });

  return {
    server: {
      port: 3008,
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      apiMiddlewarePlugin()
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
