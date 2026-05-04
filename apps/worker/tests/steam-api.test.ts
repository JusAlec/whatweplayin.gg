import { test, expect, describe, vi, beforeEach } from 'vitest';
import { getOwnedGames, SteamPrivateProfileError } from '../src/lib/steam-api.js';

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
