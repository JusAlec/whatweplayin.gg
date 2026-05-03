import { test, expect } from 'vitest';
// @ts-expect-error - SELF is provided by @cloudflare/vitest-pool-workers
import { SELF } from 'cloudflare:test';

test('worker serves a 200 on root', async () => {
  const res = await SELF.fetch('https://example.com/');
  expect(res.status).toBe(200);
});
