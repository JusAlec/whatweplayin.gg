import { test, expect, beforeEach } from 'vitest';
// @ts-expect-error
import { SELF, env } from 'cloudflare:test';

const SECRET = { 'x-group-secret': 'topsecret' };

beforeEach(async () => {
  const list = await env.KV.list();
  for (const k of list.keys) await env.KV.delete(k.name);
  await env.KV.put('group:g1:secret', 'topsecret');
  await env.KV.put('group:g1:rating-cache:valheim', JSON.stringify({ combat: { avg: 3, variance: 0, n: 2 } }));
  await env.KV.put('group:g1:person:alec:owns:valheim', JSON.stringify(true));
  await env.KV.put('group:g1:session:2026-05-02T19:00:00Z', JSON.stringify({
    startedAt: '2026-05-02T19:00:00Z', attendees: ['alec'], gamePicked: 'valheim',
  }));
});

test('GET /state returns aggregated group state', async () => {
  const res = await SELF.fetch('https://x/groups/g1/state', { headers: SECRET });
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, any>;
  expect(body.ratingCache.valheim.combat.n).toBe(2);
  expect(body.ownership.alec.valheim).toBe(true);
  expect(body.sessions[0].gamePicked).toBe('valheim');
});
