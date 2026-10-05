import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root, publicDir:path.resolve(root,'../../../../public'), plugins:[{name:'fixture-master-only', enforce:'pre', resolveId(source, importer){if (source.endsWith('/utils/services/masterScheduleService') && importer?.endsWith('RegionalTransitConnections.tsx')) return path.join(root,'fixture.ts');}},react()],server:{host:'127.0.0.1',port:8767,strictPort:true,fs:{allow:[path.resolve(root,'../../../..')]}}});
