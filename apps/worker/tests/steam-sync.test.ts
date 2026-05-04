import { test, expect, describe, beforeEach, vi } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { syncSteamLibrary } from '../src/lib/steam-sync.js';
import { __resetSkippedAppIdsForTesting } from '../src/lib/steam-api.js';

const db = () => new Db(env.DB);

beforeEach(async () => {
  __resetSkippedAppIdsForTesting();
  // Inject a Steam API key for tests (real Steam HTTP is mocked via fetchImpl).
  env.STEAM_API_KEY = 'test-steam-api-key';
  await env.DB.batch([
    env.DB.prepare('DELETE FROM thumbs'),
    env.DB.prepare('DELETE FROM game_ownership'),
    env.DB.prepare('DELETE FROM games'),
    env.DB.prepare('DELETE FROM oauth_accounts'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const now = new Date().toISOString();
  await db().users.insert({
    id: 'u1',
    email: 'a@b.co',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  });
});

describe('syncSteamLibrary — ownership upserts', () => {
  test('writes game_ownership rows for each returned game', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 2,
              games: [
                { appid: 730, name: 'CS2', playtime_forever: 1234, rtime_last_played: 1700000000 },
                {
                  appid: 892970,
                  name: 'Valheim',
                  playtime_forever: 567,
                  rtime_last_played: 1710000000,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });

    const ownership = await env.DB.prepare(
      'SELECT game_id, playtime_minutes FROM game_ownership WHERE user_id = ?',
    )
      .bind('u1')
      .all();
    expect(ownership.results.length).toBe(2);
  });

  test('updates users.steam_library_synced_at to NOW', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: { game_count: 0, games: [] } }), { status: 200 }),
    );
    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });
    const user = await db().users.getById('u1');
    expect(user?.steamLibrarySyncedAt).not.toBeNull();
    expect(user?.steamLibrarySyncedAt).not.toBeUndefined();
    expect(new Date(user!.steamLibrarySyncedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('syncSteamLibrary — private profile', () => {
  test('throws SteamPrivateProfileError + still bumps synced_at', async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ response: {} }), { status: 200 }),
    );
    const { SteamPrivateProfileError } = await import('../src/lib/steam-api.js');

    await expect(
      syncSteamLibrary(env, 'u1', '76561198000000001', {
        fetchImpl: fakeFetch as typeof fetch,
        enrichmentEnabled: false,
      }),
    ).rejects.toBeInstanceOf(SteamPrivateProfileError);

    const user = await db().users.getById('u1');
    expect(user?.steamLibrarySyncedAt).not.toBeNull();
    expect(user?.steamLibrarySyncedAt).not.toBeUndefined();
  });
});

describe('syncSteamLibrary — removed games cleanup', () => {
  test('deletes ownership rows for games no longer in Steam library', async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
         VALUES (?, ?, ?, ?, 'auto')`,
      ).bind('steam-1', 'G1', 1, now),
      env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
         VALUES (?, ?, ?, ?, 'auto')`,
      ).bind('steam-2', 'G2', 2, now),
      env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
         VALUES (?, ?, ?, ?, 'auto')`,
      ).bind('steam-3', 'G3', 3, now),
      env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
         VALUES ('u1', 'steam-1', 'steam', 100, ?), ('u1', 'steam-2', 'steam', 200, ?), ('u1', 'steam-3', 'steam', 300, ?)`,
      ).bind(now, now, now),
    ]);

    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              game_count: 2,
              games: [
                { appid: 1, name: 'G1', playtime_forever: 100, rtime_last_played: 0 },
                { appid: 3, name: 'G3', playtime_forever: 300, rtime_last_played: 0 },
              ],
            },
          }),
          { status: 200 },
        ),
    );

    const result = await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });

    expect(result.ownershipRemoved).toBe(1);
    const remaining = await env.DB.prepare(
      'SELECT game_id FROM game_ownership WHERE user_id = ?',
    )
      .bind('u1')
      .all();
    const ids = remaining.results.map((r: any) => r.game_id);
    expect(ids).toEqual(expect.arrayContaining(['steam-1', 'steam-3']));
    expect(ids).not.toContain('steam-2');
  });
});
