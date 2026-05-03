import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.ts',
        miniflare: {
          kvNamespaces: ['KV'],
          compatibilityDate: '2026-04-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
    include: ['tests/**/*.test.ts'],
  },
});
