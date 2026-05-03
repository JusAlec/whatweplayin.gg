import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { fileURLToPath } from 'node:url';
import { existsSync, cpSync, mkdirSync } from 'node:fs';

const dataSrc = fileURLToPath(new URL('../../data', import.meta.url));
const dataDest = fileURLToPath(new URL('./public/data', import.meta.url));
mkdirSync(dataDest, { recursive: true });
if (existsSync(dataSrc)) cpSync(dataSrc, dataDest, { recursive: true });

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  vite: {
    define: {
      'import.meta.env.PUBLIC_WORKER_URL': JSON.stringify(
        process.env.PUBLIC_WORKER_URL ?? 'http://localhost:8787',
      ),
    },
    resolve: {
      alias: {
        '@data': dataSrc,
      },
    },
  },
});
