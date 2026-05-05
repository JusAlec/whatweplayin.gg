import { test, expect, describe, beforeEach, vi } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { getIGDBToken, fetchIGDBGameByAppId } from '../src/lib/igdb-api.js';

beforeEach(async () => {
  env.IGDB_CLIENT_ID = 'test-client-id';
  env.IGDB_CLIENT_SECRET = 'test-client-secret';
  await env.DB.prepare('DELETE FROM igdb_token').run();
});

describe('getIGDBToken', () => {
  test('fetches a fresh token when cache is empty', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'tok-fresh', expires_in: 5184000, token_type: 'bearer' }),
          { status: 200 },
        ),
    );
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-fresh');
    const row = await env.DB.prepare('SELECT access_token FROM igdb_token WHERE id = 1').first();
    expect((row as { access_token: string }).access_token).toBe('tok-fresh');
  });

  test('returns cached token when far from expiry', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
    )
      .bind('tok-cached', future, new Date().toISOString())
      .run();
    const fakeFetch = vi.fn();
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-cached');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  test('refreshes when within 24h of expiry', async () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
    )
      .bind('tok-stale', soon, new Date().toISOString())
      .run();
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok-refreshed', expires_in: 5184000 }), {
          status: 200,
        }),
    );
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-refreshed');
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  test('throws when Twitch token endpoint fails', async () => {
    const fakeFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(getIGDBToken(env, fakeFetch as typeof fetch)).rejects.toThrow();
  });

  test('throws when client credentials are missing', async () => {
    env.IGDB_CLIENT_ID = '';
    env.IGDB_CLIENT_SECRET = '';
    const fakeFetch = vi.fn();
    await expect(getIGDBToken(env, fakeFetch as typeof fetch)).rejects.toThrow();
  });
});

async function seedToken() {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
  )
    .bind('tok-test', future, new Date().toISOString())
    .run();
}

describe('fetchIGDBGameByAppId', () => {
  beforeEach(seedToken);

  test('returns parsed game data on success', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              name: 'Counter-Strike 2',
              summary: 'Free-to-play tactical shooter.',
              genres: [{ name: 'Shooter' }, { name: 'Strategy' }],
              multiplayer_modes: [{ online_max: 10, online_coop_max: 0, lan_max: 10 }],
              cover: { image_id: 'co1abc' },
              screenshots: [{ image_id: 'sc1xyz' }],
            },
          ]),
          { status: 200 },
        ),
    );
    const game = await fetchIGDBGameByAppId(env, 730, fakeFetch as typeof fetch);
    expect(game).not.toBeNull();
    expect(game!.name).toBe('Counter-Strike 2');
    expect(game!.summary).toContain('shooter');
    expect(game!.genres).toEqual([{ name: 'Shooter' }, { name: 'Strategy' }]);
    expect(game!.multiplayer_modes![0]!.online_max).toBe(10);
    expect(game!.cover!.image_id).toBe('co1abc');
    expect(game!.screenshots![0]!.image_id).toBe('sc1xyz');
  });

  test('returns null when game is not in IGDB', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const game = await fetchIGDBGameByAppId(env, 99999, fakeFetch as typeof fetch);
    expect(game).toBeNull();
  });

  test('returns null on HTTP error (not throwing — caller decides)', async () => {
    const fakeFetch = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const game = await fetchIGDBGameByAppId(env, 730, fakeFetch as typeof fetch);
    expect(game).toBeNull();
  });

  test('builds APICalypse query with external_games filter', async () => {
    const fakeFetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify([]), { status: 200 }),
    );
    await fetchIGDBGameByAppId(env, 730, fakeFetch as unknown as typeof fetch);
    const [, init] = fakeFetch.mock.calls[0]!;
    const body = (init as RequestInit).body as string;
    expect(body).toContain('external_games.category = 1');
    expect(body).toContain('external_games.uid = "730"');
    expect(body).toContain('limit 1');
    expect(body).toContain('genres.name');
    expect(body).toContain('multiplayer_modes');
  });
});
