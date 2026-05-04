import { test, expect, describe } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF } from 'cloudflare:test';

describe('GET /api/config', () => {
  test('returns the four boolean flags', async () => {
    const res = await SELF.fetch('https://x/api/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: {
        autosyncOnLogin: boolean;
        thumbs: boolean;
        recommendations: boolean;
        steamRatings: boolean;
      };
    };
    expect(typeof body.flags.autosyncOnLogin).toBe('boolean');
    expect(typeof body.flags.thumbs).toBe('boolean');
    expect(typeof body.flags.recommendations).toBe('boolean');
    expect(typeof body.flags.steamRatings).toBe('boolean');
  });

  test('returns json content-type', async () => {
    const res = await SELF.fetch('https://x/api/config');
    expect(res.headers.get('content-type')).toContain('json');
  });

  test('does not require authentication', async () => {
    // No cookie passed; should still return 200.
    const res = await SELF.fetch('https://x/api/config');
    expect(res.status).toBe(200);
  });
});
