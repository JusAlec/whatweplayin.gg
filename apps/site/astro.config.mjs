import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [react(), tailwind()],
  output: 'static',
  vite: {
    define: {
      'import.meta.env.PUBLIC_WORKER_URL': JSON.stringify(
        process.env.PUBLIC_WORKER_URL ?? 'http://localhost:8787',
      ),
    },
  },
});
