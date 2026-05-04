import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, 'migrations'),
  );

  return {
    test: {
      setupFiles: ['./tests/setup/apply-migrations.ts'],
      poolOptions: {
        workers: {
          main: './src/index.ts',
          miniflare: {
            kvNamespaces: ['KV'],
            d1Databases: ['DB'],
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
            compatibilityDate: '2026-04-01',
            compatibilityFlags: ['nodejs_compat'],
          },
        },
      },
      include: ['tests/**/*.test.ts'],
    },
  };
});
