import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';

const SECRET = { 'x-group-secret': 'topsecret' };

beforeEach(async () => {
  const list = await env.KV.list();
  for (const k of list.keys) await env.KV.delete(k.name);
  await env.KV.put('group:g1:secret', 'topsecret');
});

describe('vote write + cache recompute', () => {
  test('PUT vote stores it under per-user-game-dim key', async () => {
    await SELF.fetch('https://x/groups/g1/votes/alec/valheim/combat', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 4 }),
    });
    const stored = await env.KV.get('group:g1:vote:alec:valheim:combat');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.value).toBe(4);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('vote write recomputes rating cache for that game', async () => {
    await SELF.fetch('https://x/groups/g1/votes/alec/valheim/combat', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 4 }),
    });
    await SELF.fetch('https://x/groups/g1/votes/mike/valheim/combat', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 2 }),
    });
    const cache = JSON.parse((await env.KV.get('group:g1:rating-cache:valheim'))!);
    expect(cache.combat.n).toBe(2);
    expect(cache.combat.avg).toBe(3);
  });

  test('rejects vote outside 1-5', async () => {
    const res = await SELF.fetch('https://x/groups/g1/votes/alec/valheim/combat', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 6 }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects unknown dimension', async () => {
    const res = await SELF.fetch('https://x/groups/g1/votes/alec/valheim/teamwork', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ value: 4 }),
    });
    expect(res.status).toBe(400);
  });
});
