import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is virtual
import { SELF, env } from 'cloudflare:test';

beforeEach(async () => {
  // Reset KV between tests
  const list = await env.KV.list();
  for (const k of list.keys) await env.KV.delete(k.name);
  // Seed group g1 secret
  await env.KV.put('group:g1:secret', 'topsecret');
});

describe('auth', () => {
  test('403 when secret is missing', async () => {
    const res = await SELF.fetch('https://x/groups/g1/state');
    expect(res.status).toBe(403);
  });

  test('403 when secret is wrong', async () => {
    const res = await SELF.fetch('https://x/groups/g1/state', {
      headers: { 'x-group-secret': 'nope' },
    });
    expect(res.status).toBe(403);
  });

  test('403 when group does not exist', async () => {
    const res = await SELF.fetch('https://x/groups/unknown/state', {
      headers: { 'x-group-secret': 'topsecret' },
    });
    expect(res.status).toBe(403);
  });

  test('200 when secret matches (returns 404 from missing route, but auth passed)', async () => {
    const res = await SELF.fetch('https://x/groups/g1/state', {
      headers: { 'x-group-secret': 'topsecret' },
    });
    // route /state is implemented in next task; for now any non-403 means auth succeeded
    expect(res.status).not.toBe(403);
  });
});
