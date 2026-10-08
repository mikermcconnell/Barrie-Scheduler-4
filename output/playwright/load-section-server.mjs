import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 5199 }, esbuild: { jsx: 'automatic' } });
await server.listen();
console.log('Load section harness: http://127.0.0.1:5199/output/playwright/load-section-harness.html');
