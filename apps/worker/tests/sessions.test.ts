import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error
import { SELF, env } from 'cloudflare:test';

const SECRET = { 'x-group-secret': 'topsecret' };

beforeEach(async () => {
  const list = await env.KV.list();
  for (const k of list.keys) await env.KV.delete(k.name);
  await env.KV.put('group:g1:secret', 'topsecret');
});

describe('sessions', () => {
  test('POST appends a session record', async () => {
    const session = {
      startedAt: '2026-05-03T19:00:00Z',
      attendees: ['alec', 'mike'],
      gamePicked: 'valheim',
      recommendationScore: 0.82,
      recommendedRank: 1,
    };
    const res = await SELF.fetch('https://x/groups/g1/sessions', {
      method: 'POST', headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(session),
    });
    expect(res.status).toBe(200);
    const stored = await env.KV.get('group:g1:session:2026-05-03T19:00:00Z');
    expect(JSON.parse(stored!)).toEqual(session);
  });

  test('GET sessions returns chronological list (most recent first)', async () => {
    await env.KV.put(
      'group:g1:session:2026-05-01T19:00:00Z',
      JSON.stringify({ startedAt: '2026-05-01T19:00:00Z', attendees: ['alec'], gamePicked: 'ark' }),
    );
    await env.KV.put(
      'group:g1:session:2026-05-02T19:00:00Z',
      JSON.stringify({ startedAt: '2026-05-02T19:00:00Z', attendees: ['alec'], gamePicked: 'valheim' }),
    );
    const res = await SELF.fetch('https://x/groups/g1/sessions', { headers: SECRET });
    const list = (await res.json()) as Array<{ startedAt: string }>;
    expect(list.map((s) => s.startedAt)).toEqual([
      '2026-05-02T19:00:00Z',
      '2026-05-01T19:00:00Z',
    ]);
  });

  test('rejects session without required fields', async () => {
    const res = await SELF.fetch('https://x/groups/g1/sessions', {
      method: 'POST', headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ attendees: ['alec'] }),
    });
    expect(res.status).toBe(400);
  });
});
