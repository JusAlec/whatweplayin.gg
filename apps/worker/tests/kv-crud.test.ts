import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';

const SECRET = { 'x-group-secret': 'topsecret' };

beforeEach(async () => {
  const list = await env.KV.list();
  for (const k of list.keys) await env.KV.delete(k.name);
  await env.KV.put('group:g1:secret', 'topsecret');
});

describe('person prefs', () => {
  test('PUT then GET returns the stored prefs', async () => {
    const prefs = {
      combat: 4,
      grind: 2,
      buildingDepth: 3,
      commitmentLevel: 4,
      pvpFocus: 1,
      sessionLength: 3,
    };
    await SELF.fetch('https://x/groups/g1/people/alec/prefs', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    const res = await SELF.fetch('https://x/groups/g1/people/alec/prefs', { headers: SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(prefs);
  });

  test('GET returns null when prefs absent', async () => {
    const res = await SELF.fetch('https://x/groups/g1/people/alec/prefs', { headers: SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test('PUT rejects non-1..5 values', async () => {
    const res = await SELF.fetch('https://x/groups/g1/people/alec/prefs', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({
        combat: 10,
        grind: 3,
        buildingDepth: 3,
        commitmentLevel: 3,
        pvpFocus: 3,
        sessionLength: 3,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('ownership', () => {
  test('PUT owns toggle and GET reflects it', async () => {
    await SELF.fetch('https://x/groups/g1/people/alec/owns/valheim', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(true),
    });
    const res = await SELF.fetch('https://x/groups/g1/people/alec/owns/valheim', {
      headers: SECRET,
    });
    expect(await res.json()).toBe(true);
  });
});

describe('game-status and progress', () => {
  test('PUT and GET game-status', async () => {
    await SELF.fetch('https://x/groups/g1/games/valheim/status', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify('in_progress'),
    });
    const res = await SELF.fetch('https://x/groups/g1/games/valheim/status', { headers: SECRET });
    expect(await res.json()).toBe('in_progress');
  });

  test('rejects unknown status', async () => {
    const res = await SELF.fetch('https://x/groups/g1/games/valheim/status', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify('garbage'),
    });
    expect(res.status).toBe(400);
  });
});

describe('tonight input', () => {
  test('PUT and GET tonight', async () => {
    const t = { mood: 3, timeAvailableMins: 120, atTimestamp: '2026-05-03T19:00:00Z' };
    await SELF.fetch('https://x/groups/g1/people/alec/tonight', {
      method: 'PUT',
      headers: { ...SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(t),
    });
    const res = await SELF.fetch('https://x/groups/g1/people/alec/tonight', { headers: SECRET });
    expect(await res.json()).toEqual(t);
  });
});
