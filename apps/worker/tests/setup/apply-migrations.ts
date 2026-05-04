// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { applyD1Migrations } from 'cloudflare:test';

// Apply all D1 migrations to the test database before tests run.
// The migrations are injected via the TEST_MIGRATIONS env binding (see vitest.config.ts).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
