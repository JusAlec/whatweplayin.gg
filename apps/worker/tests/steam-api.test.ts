import { test, expect, describe, vi, beforeEach } from 'vitest';
import {
  getOwnedGames,
  SteamPrivateProfileError,
  fetchAppDetails,
  fetchAppReviews,
  isAppidSkipped,
  markAppidSkipped,
  __resetSkippedAppIdsForTesting,
} from '../src/lib/steam-api.js';

describe('getOwnedGames', () => {
  test('returns parsed games array on success', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
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
        ),
    );
    const result = await getOwnedGames('apikey', '76561198000000001', fakeFetch as typeof fetch);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      appid: 730,
      name: 'CS2',
      playtimeForever: 1234,
      rtimeLastPlayed: 1700000000,
    });
  });

  test('throws SteamPrivateProfileError when response has no games key', async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ response: {} }), { status: 200 }),
    );
    await expect(
      getOwnedGames('apikey', '76561198000000001', fakeFetch as typeof fetch),
    ).rejects.toBeInstanceOf(SteamPrivateProfileError);
  });

  test('throws on non-200 response', async () => {
    const fakeFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(
      getOwnedGames('badkey', '76561198000000001', fakeFetch as typeof fetch),
    ).rejects.toThrow();
  });

  test('builds correct URL with key, steamid, include_played_free_games', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: { game_count: 0, games: [] } }), { status: 200 }),
    );
    await getOwnedGames('mykey', '76561198000000001', fakeFetch as typeof fetch);
    const calledUrl = fakeFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('key=mykey');
    expect(calledUrl).toContain('steamid=76561198000000001');
    expect(calledUrl).toContain('include_played_free_games=1');
    expect(calledUrl).toContain('include_appinfo=1');
  });

  test('coerces rtime_last_played=0 to null (never played)', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              games: [{ appid: 1, name: 'X', playtime_forever: 0, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        ),
    );
    const [g] = await getOwnedGames('k', '7', fakeFetch as typeof fetch);
    expect(g!.rtimeLastPlayed).toBeNull();
  });
});

describe('fetchAppDetails', () => {
  test('parses categories, type, header_image for a game', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: {
                type: 'game',
                name: 'Counter-Strike 2',
                header_image: 'https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg',
                categories: [
                  { id: 1, description: 'Multi-player' },
                  { id: 49, description: 'PvP' },
                  { id: 36, description: 'Online PvP' },
                ],
                release_date: { coming_soon: false, date: '21 Aug, 2012' },
              },
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchAppDetails(730, fakeFetch as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('game');
    expect(result!.name).toBe('Counter-Strike 2');
    expect(result!.headerImage).toContain('header.jpg');
    expect(result!.hasSinglePlayer).toBe(false);
    expect(result!.hasCoop).toBe(false);
    expect(result!.hasPvp).toBe(true);
  });

  test('returns null when type is not game (DLC, soundtrack)', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            '12345': {
              success: true,
              data: { type: 'dlc', name: 'Some DLC', header_image: '', categories: [] },
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchAppDetails(12345, fakeFetch as typeof fetch);
    expect(result).toBeNull();
  });

  test('returns null when success is false', async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ '99999': { success: false } }), { status: 200 }),
    );
    const result = await fetchAppDetails(99999, fakeFetch as typeof fetch);
    expect(result).toBeNull();
  });

  test('detects co-op + single-player categories', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            '892970': {
              success: true,
              data: {
                type: 'game',
                name: 'Valheim',
                header_image: '',
                categories: [
                  { id: 1, description: 'Multi-player' },
                  { id: 9, description: 'Co-op' },
                  { id: 38, description: 'Online Co-op' },
                  { id: 2, description: 'Single-player' },
                ],
              },
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchAppDetails(892970, fakeFetch as typeof fetch);
    expect(result!.hasCoop).toBe(true);
    expect(result!.hasSinglePlayer).toBe(true);
    expect(result!.hasPvp).toBe(false);
  });
});

describe('fetchAppReviews', () => {
  test('parses query_summary into review fields', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
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
        ),
    );
    const result = await fetchAppReviews(730, fakeFetch as typeof fetch);
    expect(result).toEqual({
      score: 9,
      scoreDesc: 'Overwhelmingly Positive',
      pctPositive: 95,
      count: 1000000,
    });
  });

  test('returns null when total_reviews is 0 (no reviews)', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: 1,
            query_summary: {
              review_score: 0,
              review_score_desc: 'No user reviews',
              total_positive: 0,
              total_reviews: 0,
            },
          }),
          { status: 200 },
        ),
    );
    const result = await fetchAppReviews(99999, fakeFetch as typeof fetch);
    expect(result).toBeNull();
  });

  test('returns null on HTTP error', async () => {
    const fakeFetch = vi.fn(async () => new Response('error', { status: 500 }));
    const result = await fetchAppReviews(730, fakeFetch as typeof fetch);
    expect(result).toBeNull();
  });
});

describe('skipped appid cache', () => {
  beforeEach(() => __resetSkippedAppIdsForTesting());

  test('marks and reads skipped appid', () => {
    const now = new Date('2026-05-04T00:00:00Z');
    expect(isAppidSkipped(123, now)).toBe(false);
    markAppidSkipped(123, now);
    expect(isAppidSkipped(123, now)).toBe(true);
  });

  test('expires after 24 hours', () => {
    const start = new Date('2026-05-04T00:00:00Z');
    markAppidSkipped(456, start);
    const after = new Date('2026-05-05T01:00:00Z');
    expect(isAppidSkipped(456, after)).toBe(false);
  });

  test('still skipped within 24-hour window', () => {
    const start = new Date('2026-05-04T00:00:00Z');
    markAppidSkipped(789, start);
    const within = new Date('2026-05-04T20:00:00Z');
    expect(isAppidSkipped(789, within)).toBe(true);
  });
});
