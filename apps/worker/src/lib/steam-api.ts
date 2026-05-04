const STEAM_OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

export class SteamPrivateProfileError extends Error {
  constructor() {
    super('Steam profile is private; cannot read library');
    this.name = 'SteamPrivateProfileError';
  }
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtimeForever: number; // minutes
  rtimeLastPlayed: number | null; // unix seconds; 0 means never played → coerced to null
}

interface SteamOwnedGameRaw {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
}

interface SteamOwnedGamesResponse {
  response: { game_count?: number; games?: SteamOwnedGameRaw[] };
}

export async function getOwnedGames(
  apiKey: string,
  steamId64: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnedGame[]> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId64,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  });
  const res = await fetchImpl(`${STEAM_OWNED_GAMES_URL}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`GetOwnedGames HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as SteamOwnedGamesResponse;
  if (!json.response.games) {
    throw new SteamPrivateProfileError();
  }
  return json.response.games.map((g) => ({
    appid: g.appid,
    name: g.name,
    playtimeForever: g.playtime_forever,
    rtimeLastPlayed: g.rtime_last_played && g.rtime_last_played > 0 ? g.rtime_last_played : null,
  }));
}
