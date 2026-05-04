import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'server',
  adapter: cloudflare(),
  vite: {
    define: {
      'import.meta.env.PUBLIC_WORKER_URL': JSON.stringify(
        process.env.PUBLIC_WORKER_URL ?? 'http://localhost:8787',
      ),
    },
  },
});
