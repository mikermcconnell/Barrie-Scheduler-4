import { build } from 'vite';

process.env.NODE_ENV = 'production';

await build({ mode: 'production' });
