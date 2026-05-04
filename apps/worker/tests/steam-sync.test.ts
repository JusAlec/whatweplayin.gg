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
    const remaining = await env.DB.prepare('SELECT game_id FROM game_ownership WHERE user_id = ?')
      .bind('u1')
      .all();
    const ids = remaining.results.map((r: any) => r.game_id);
    expect(ids).toEqual(expect.arrayContaining(['steam-1', 'steam-3']));
    expect(ids).not.toContain('steam-2');
  });
});

describe('syncSteamLibrary — enrichment', () => {
  test('calls appdetails + appreviews for new games and updates the games row', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 730, name: 'CS2', playtime_forever: 100, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: {
                type: 'game',
                name: 'Counter-Strike 2',
                header_image: 'https://cdn.example/header.jpg',
                categories: [
                  { id: 1, description: 'Multi-player' },
                  { id: 49, description: 'PvP' },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response(
          JSON.stringify({
            success: 1,
            query_summary: {
              review_score: 9,
              review_score_desc: 'Overwhelmingly Positive',
              total_positive: 950000,
              total_reviews: 1000000,
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
      enrichmentParallelism: 1,
    });

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind('steam-730').first();
    expect(game).not.toBeNull();
    expect((game as any).name).toBe('Counter-Strike 2');
    expect((game as any).cover_url).toBe('https://cdn.example/header.jpg');
    expect((game as any).has_pvp).toBe(1);
    expect((game as any).has_singleplayer).toBe(0);
    expect((game as any).steam_review_pct_positive).toBe(95);
    expect((game as any).steam_review_score_desc).toBe('Overwhelmingly Positive');
    expect((game as any).metadata_synced_at).toBeTruthy();
    expect((game as any).metadata_synced_at).not.toBe('');
  });

  test('skips enrichment for non-game appids and marks them in skip cache', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [
                { appid: 12345, name: 'Some DLC', playtime_forever: 0, rtime_last_played: 0 },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '12345': {
              success: true,
              data: { type: 'dlc', name: 'Some DLC', header_image: '', categories: [] },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
    });

    const appreviewsCalls = fakeFetch.mock.calls.filter((c) =>
      (c[0] as string).includes('appreviews'),
    );
    expect(appreviewsCalls.length).toBe(0);

    const game = await env.DB.prepare('SELECT metadata_synced_at FROM games WHERE id = ?')
      .bind('steam-12345')
      .first();
    expect((game as any).metadata_synced_at).toBe('');
  });

  test('handles appreviews failure by leaving review fields NULL but still enriches game', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 999, name: 'Indie', playtime_forever: 50, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '999': {
              success: true,
              data: {
                type: 'game',
                name: 'Indie',
                header_image: 'https://cdn.example/h.jpg',
                categories: [{ id: 2, description: 'Single-player' }],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response('error', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    });

    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
    });

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind('steam-999').first();
    expect((game as any).name).toBe('Indie');
    expect((game as any).has_singleplayer).toBe(1);
    expect((game as any).steam_review_pct_positive).toBeNull();
    expect((game as any).metadata_synced_at).not.toBe('');
  });
});

describe('syncSteamLibrary — ownership removed count edge cases', () => {
  test('returns 0 when no games are removed (empty library, empty pre-state)', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: { game_count: 0, games: [] } }), { status: 200 }),
    );
    const result = await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });
    expect(result.ownershipRemoved).toBe(0);
  });

  test('returns 0 when sync returns same library (no removals needed)', async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
         VALUES (?, ?, ?, ?, 'auto')`,
      ).bind('steam-100', 'Game', 100, now),
      env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
         VALUES ('u1', 'steam-100', 'steam', 50, ?)`,
      ).bind(now),
    ]);
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 100, name: 'Game', playtime_forever: 60, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        ),
    );
    const result = await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });
    expect(result.ownershipRemoved).toBe(0);
  });

  test('caps enrichment per run + reports unenrichedRemaining', async () => {
    // 30 games returned; default cap is 20 enrichments per run. The first run
    // should enrich 20 and report 10 unenriched still pending.
    const games = Array.from({ length: 30 }, (_, i) => ({
      appid: 5000 + i,
      name: `Cap${i}`,
      playtime_forever: 0,
      rtime_last_played: 0,
    }));
    let appdetailsCalls = 0;
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(JSON.stringify({ response: { game_count: games.length, games } }), {
          status: 200,
        });
      }
      if (url.includes('appdetails')) {
        appdetailsCalls++;
        // Extract appid from the URL: ?appids=N&filters=...
        const m = url.match(/appids=(\d+)/);
        const appid: string = m?.[1] ?? '0';
        return new Response(
          JSON.stringify({
            [appid]: {
              success: true,
              data: {
                type: 'game',
                name: `Cap${appid}`,
                header_image: '',
                categories: [{ id: 1, description: 'Multi-player' }],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response(
          JSON.stringify({
            success: 1,
            query_summary: {
              review_score: 8,
              review_score_desc: 'Very Positive',
              total_positive: 90,
              total_reviews: 100,
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });
    const result = await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
    });
    expect(result.gamesAdded).toBe(30);
    expect(result.enrichmentDeferred).toBe(20);
    expect(result.unenrichedRemaining).toBe(10);
    expect(appdetailsCalls).toBe(20);
  });

  test('handles libraries > 100 games (D1 bind-variable limit guard)', async () => {
    // 250 games — well over D1's ~100 SQL bind variable limit, which used to
    // crash sync with "too many SQL variables" on real users.
    const games = Array.from({ length: 250 }, (_, i) => ({
      appid: 1000 + i,
      name: `Game${i}`,
      playtime_forever: i,
      rtime_last_played: 0,
    }));
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: { game_count: games.length, games } }), {
          status: 200,
        }),
    );
    const result = await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: false,
    });
    expect(result.gamesAdded).toBe(250);
    const ownership = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM game_ownership WHERE user_id = ?',
    )
      .bind('u1')
      .first();
    expect((ownership as { n: number }).n).toBe(250);
  });
});
