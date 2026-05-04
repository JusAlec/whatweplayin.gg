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

const STEAM_APP_DETAILS_URL = 'https://store.steampowered.com/api/appdetails';
const STEAM_APP_REVIEWS_URL = 'https://store.steampowered.com/appreviews';

export interface AppDetails {
  type: 'game';
  name: string;
  headerImage: string;
  hasSinglePlayer: boolean;
  hasCoop: boolean;
  hasPvp: boolean;
  releaseDate: string | null;
}

interface AppDetailsRaw {
  type?: string;
  name?: string;
  header_image?: string;
  categories?: Array<{ id: number; description: string }>;
  release_date?: { coming_soon?: boolean; date?: string };
}

interface AppDetailsEnvelope {
  [appid: string]: { success: boolean; data?: AppDetailsRaw };
}

const COOP_CATEGORIES = new Set(['Co-op', 'Online Co-op', 'Shared/Split Screen Co-op']);
const PVP_CATEGORIES = new Set(['PvP', 'Online PvP', 'Shared/Split Screen PvP']);

export async function fetchAppDetails(
  appid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AppDetails | null> {
  const url = `${STEAM_APP_DETAILS_URL}?appids=${appid}&filters=basic,categories,release_date`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;

  const json = (await res.json()) as AppDetailsEnvelope;
  const entry = json[String(appid)];
  if (!entry?.success || !entry.data) return null;

  const data = entry.data;
  if (data.type !== 'game') return null;

  const categories = (data.categories ?? []).map((c) => c.description);
  const hasSinglePlayer = categories.includes('Single-player');
  const hasCoop = categories.some((c) => COOP_CATEGORIES.has(c));
  const hasPvp = categories.some((c) => PVP_CATEGORIES.has(c));

  return {
    type: 'game',
    name: data.name ?? `App ${appid}`,
    headerImage: data.header_image ?? '',
    hasSinglePlayer,
    hasCoop,
    hasPvp,
    releaseDate: data.release_date?.date ?? null,
  };
}

export interface AppReviews {
  score: number;
  scoreDesc: string;
  pctPositive: number;
  count: number;
}

interface AppReviewsRaw {
  success?: number;
  query_summary?: {
    review_score?: number;
    review_score_desc?: string;
    total_positive?: number;
    total_reviews?: number;
  };
}

export async function fetchAppReviews(
  appid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AppReviews | null> {
  const url = `${STEAM_APP_REVIEWS_URL}/${appid}?json=1&filter=summary&purchase_type=all&language=all`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;

  const json = (await res.json()) as AppReviewsRaw;
  const s = json.query_summary;
  if (!s || !s.total_reviews || s.total_reviews === 0) return null;

  const pct = Math.round(((s.total_positive ?? 0) / s.total_reviews) * 100);
  return {
    score: s.review_score ?? 0,
    scoreDesc: s.review_score_desc ?? '',
    pctPositive: pct,
    count: s.total_reviews,
  };
}

const SKIPPED_APPID_TTL_MS = 24 * 60 * 60 * 1000;

interface SkippedEntry {
  until: number;
}

const skippedAppIds = new Map<number, SkippedEntry>();

export function isAppidSkipped(appid: number, now: Date = new Date()): boolean {
  const entry = skippedAppIds.get(appid);
  if (!entry) return false;
  if (entry.until < now.getTime()) {
    skippedAppIds.delete(appid);
    return false;
  }
  return true;
}

export function markAppidSkipped(appid: number, now: Date = new Date()): void {
  skippedAppIds.set(appid, { until: now.getTime() + SKIPPED_APPID_TTL_MS });
}

/** Test helper — clears the cache between tests to keep them deterministic. */
export function __resetSkippedAppIdsForTesting(): void {
  skippedAppIds.clear();
}
