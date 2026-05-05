import {
  getOwnedGames,
  fetchAppDetails,
  fetchAppReviews,
  isAppidSkipped,
  markAppidSkipped,
  SteamPrivateProfileError,
  type OwnedGame,
} from './steam-api.js';
import type { Env } from '../index.js';
import { Db } from './d1-client.js';
import { readNumber } from './flags.js';

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  enrichmentEnabled?: boolean; // default true
  enrichmentParallelism?: number; // default 3
}

export interface SyncResult {
  gamesAdded: number;
  gamesUpdated: number;
  ownershipRemoved: number;
  /** How many games we attempted to enrich during this invocation. */
  enrichmentDeferred: number;
  /**
   * How many games owned by this user are STILL un-enriched after this run.
   * Non-zero means the user should click Refresh library again to continue
   * (we can't process all enrichments in one Cloudflare Workers invocation
   * because of the per-invocation subrequest cap on the free tier — see
   * WWP_ENRICHMENT_MAX_PER_RUN).
   */
  unenrichedRemaining: number;
  syncedAt: string;
}

/**
 * Sync a user's Steam library: pull owned games, upsert ownership, optionally
 * enrich new games with Store API metadata. Single entry point for all three
 * sync triggers (Link Steam initial, autosync, manual refresh).
 */
export async function syncSteamLibrary(
  env: Env,
  userId: string,
  steamId64: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const enrichmentEnabled = opts.enrichmentEnabled ?? true;
  const apiKey = env.STEAM_API_KEY;
  if (!apiKey) throw new Error('STEAM_API_KEY not configured');

  const syncedAt = new Date().toISOString();
  const dbi = new Db(env.DB);

  let owned: OwnedGame[];
  try {
    owned = await getOwnedGames(apiKey, steamId64, fetchImpl);
  } catch (err) {
    // For private profile, still bump synced_at so we don't autosync-loop.
    if (err instanceof SteamPrivateProfileError) {
      await dbi.users.setSteamLibrarySyncedAt(userId, syncedAt);
    }
    throw err;
  }

  let gamesAdded = 0;
  let gamesUpdated = 0;
  for (const g of owned) {
    const gameId = `steam-${g.appid}`;
    const exists = await env.DB.prepare('SELECT 1 FROM games WHERE id = ?').bind(gameId).first();
    if (!exists) {
      // Insert stub so the FK from game_ownership is satisfied. metadata_synced_at = ''
      // is our "not-yet-enriched" sentinel; replaced when enrichment runs.
      await env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
           VALUES (?, ?, ?, ?, 'auto')`,
      )
        .bind(gameId, g.name, g.appid, '')
        .run();
      gamesAdded++;
    }

    const lastPlayed = g.rtimeLastPlayed ? new Date(g.rtimeLastPlayed * 1000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, last_played_at, added_at)
         VALUES (?, ?, 'steam', ?, ?, ?)
         ON CONFLICT (user_id, game_id) DO UPDATE
            SET playtime_minutes = excluded.playtime_minutes,
                last_played_at = excluded.last_played_at`,
    )
      .bind(userId, gameId, g.playtimeForever, lastPlayed, syncedAt)
      .run();
    if (!exists) gamesUpdated++;
  }

  // Compute & remove ownership rows for games no longer in Steam library.
  const returnedIds = owned.map((g) => `steam-${g.appid}`);
  const ownershipRemoved = await removeStaleOwnership(env, userId, returnedIds);

  await dbi.users.setSteamLibrarySyncedAt(userId, syncedAt);

  let enrichmentDeferred = 0;
  if (enrichmentEnabled) {
    enrichmentDeferred = await enrichNewGames(env, returnedIds, opts);
  }

  // Count games owned by this user that are still un-enriched. If non-zero,
  // the caller should re-trigger sync (or we should run another round via
  // autosync on next /api/me hit) to continue enrichment.
  const unenrichedRemaining = await countUnenrichedForUser(env, userId);

  return {
    gamesAdded,
    gamesUpdated,
    ownershipRemoved,
    enrichmentDeferred,
    unenrichedRemaining,
    syncedAt,
  };
}

/**
 * Run another batch of enrichment for un-enriched games owned by `userId`,
 * WITHOUT calling Steam Web API for the library (we already have ownership).
 * Used by the frontend auto-loop to continue enrichment after initial sync
 * without burning extra GetOwnedGames calls.
 */
export async function enrichUserGames(
  env: Env,
  userId: string,
  opts: SyncOptions = {},
): Promise<{ enriched: number; unenrichedRemaining: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parallelism = opts.enrichmentParallelism ?? 3; // was 6 in v2.1; dropped for IGDB rate limit (4/sec)
  const maxPerRun = readNumber(env, 'WWP_ENRICHMENT_MAX_PER_RUN', 20);

  // Find un-enriched games owned by this user.
  const result = await env.DB.prepare(
    `SELECT g.id, g.steam_app_id FROM games g
        JOIN game_ownership go ON go.game_id = g.id
       WHERE go.user_id = ?
         AND (g.metadata_synced_at = '' OR g.metadata_synced_at IS NULL)
       LIMIT ?`,
  )
    .bind(userId, maxPerRun * 2)
    .all();

  const eligible = (result.results as Array<{ id: string; steam_app_id: number }>)
    .filter((row) => !isAppidSkipped(row.steam_app_id))
    .slice(0, maxPerRun);

  for (let i = 0; i < eligible.length; i += parallelism) {
    const batch = eligible.slice(i, i + parallelism);
    await Promise.all(batch.map((row) => enrichOne(env, row.id, row.steam_app_id, fetchImpl)));
  }

  const unenrichedRemaining = await countUnenrichedForUser(env, userId);
  return { enriched: eligible.length, unenrichedRemaining };
}

async function countUnenrichedForUser(env: Env, userId: string): Promise<number> {
  const row = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM games g
        JOIN game_ownership go ON go.game_id = g.id
       WHERE go.user_id = ?
         AND (g.metadata_synced_at = '' OR g.metadata_synced_at IS NULL)`,
  )
    .bind(userId)
    .first()) as { n: number } | null;
  return row?.n ?? 0;
}

// D1 inherits SQLite's default SQLITE_MAX_VARIABLE_NUMBER, which is ~100.
// Chunk any IN/NOT-IN clause that binds one variable per id to stay safely
// under that limit. 80 leaves headroom for a few additional bind variables
// in the same statement.
const SQL_BIND_CHUNK = 80;

/**
 * Compute (current ownership) - (returnedIds) in JS, then DELETE the diff in
 * chunks. Avoids `NOT IN (?,?,?...)` which would exceed D1's bind-variable
 * limit on libraries with > ~100 games.
 */
async function removeStaleOwnership(
  env: Env,
  userId: string,
  returnedIds: string[],
): Promise<number> {
  const currentResult = await env.DB.prepare('SELECT game_id FROM game_ownership WHERE user_id = ?')
    .bind(userId)
    .all();
  const currentIds = (currentResult.results as Array<{ game_id: string }>).map((r) => r.game_id);
  const returnedSet = new Set(returnedIds);
  const stale = currentIds.filter((id) => !returnedSet.has(id));
  if (stale.length === 0) return 0;

  for (let i = 0; i < stale.length; i += SQL_BIND_CHUNK) {
    const chunk = stale.slice(i, i + SQL_BIND_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    await env.DB.prepare(
      `DELETE FROM game_ownership WHERE user_id = ? AND game_id IN (${placeholders})`,
    )
      .bind(userId, ...chunk)
      .run();
  }
  return stale.length;
}

async function enrichNewGames(
  env: Env,
  candidateGameIds: string[],
  opts: SyncOptions,
): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parallelism = opts.enrichmentParallelism ?? 3; // was 6 in v2.1; dropped for IGDB rate limit (4/sec)
  // Cloudflare Workers free tier caps subrequests per invocation at 50.
  // Each enrichment costs 2 HTTP calls (appdetails + appreviews); GetOwnedGames
  // is one more, plus a small headroom. 20 enrichments × 2 + 1 = 41 < 50.
  // Tunable via WWP_ENRICHMENT_MAX_PER_RUN. Subsequent sync calls continue
  // where this one left off (idempotent: only un-enriched rows are touched).
  const maxPerRun = readNumber(env, 'WWP_ENRICHMENT_MAX_PER_RUN', 20);

  if (candidateGameIds.length === 0) return 0;

  // Chunk the SELECT to stay under D1's bind-variable limit.
  const toEnrich: Array<{ id: string; steam_app_id: number }> = [];
  for (let i = 0; i < candidateGameIds.length; i += SQL_BIND_CHUNK) {
    const chunk = candidateGameIds.slice(i, i + SQL_BIND_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT id, steam_app_id FROM games
          WHERE id IN (${placeholders})
            AND (metadata_synced_at = '' OR metadata_synced_at IS NULL)`,
    )
      .bind(...chunk)
      .all();
    for (const row of result.results as Array<{ id: string; steam_app_id: number }>) {
      toEnrich.push(row);
    }
  }
  const eligible = toEnrich.filter((row) => !isAppidSkipped(row.steam_app_id)).slice(0, maxPerRun);

  for (let i = 0; i < eligible.length; i += parallelism) {
    const batch = eligible.slice(i, i + parallelism);
    await Promise.all(batch.map((row) => enrichOne(env, row.id, row.steam_app_id, fetchImpl)));
  }
  return eligible.length;
}

async function enrichOne(
  env: Env,
  gameId: string,
  appid: number,
  fetchImpl: typeof fetch,
): Promise<void> {
  const details = await fetchAppDetails(appid, fetchImpl);
  if (!details) {
    markAppidSkipped(appid);
    return;
  }

  let reviews = null;
  try {
    reviews = await fetchAppReviews(appid, fetchImpl);
  } catch {
    reviews = null;
  }

  // v2.2: layer IGDB on top, gated by WWP_FEAT_IGDB.
  let igdbDescription: string | null = null;
  let igdbGenres: string[] = [];
  let igdbScreenshotId: string | null = null;
  let optimalMin: number | null = null;
  let optimalMax: number | null = null;

  if (env.WWP_FEAT_IGDB === 'true') {
    try {
      const { fetchIGDBGameByAppId } = await import('./igdb-api.js');
      const igdb = await fetchIGDBGameByAppId(env, appid, fetchImpl);
      if (igdb) {
        igdbDescription = igdb.summary ?? null;
        igdbGenres = (igdb.genres ?? []).map((g) => g.name);
        // Prefer the first screenshot; fall back to cover for the hero backdrop.
        igdbScreenshotId = igdb.screenshots?.[0]?.image_id ?? igdb.cover?.image_id ?? null;
        const optimal = deriveOptimalPlayerCount(
          igdb.multiplayer_modes ?? [],
          details.hasSinglePlayer,
        );
        optimalMin = optimal.min;
        optimalMax = optimal.max;
      }
    } catch (err) {
      console.error('IGDB enrichment failed for', appid, err);
    }
  }

  const now = new Date().toISOString();
  const minPlayers = 1;
  const maxPlayers = details.hasCoop || details.hasPvp ? 8 : 1;

  await env.DB.prepare(
    `UPDATE games
        SET name = ?,
            cover_url = ?,
            has_singleplayer = ?,
            has_coop = ?,
            has_pvp = ?,
            min_players = ?,
            max_players = ?,
            optimal_min = ?,
            optimal_max = ?,
            release_date = ?,
            metadata_synced_at = ?,
            steam_review_score = ?,
            steam_review_score_desc = ?,
            steam_review_pct_positive = ?,
            steam_review_count = ?,
            description = ?,
            genres = ?,
            igdb_screenshot_id = ?
      WHERE id = ?`,
  )
    .bind(
      details.name,
      details.headerImage,
      details.hasSinglePlayer ? 1 : 0,
      details.hasCoop ? 1 : 0,
      details.hasPvp ? 1 : 0,
      minPlayers,
      maxPlayers,
      optimalMin,
      optimalMax,
      details.releaseDate,
      now,
      reviews?.score ?? null,
      reviews?.scoreDesc ?? null,
      reviews?.pctPositive ?? null,
      reviews?.count ?? null,
      igdbDescription,
      JSON.stringify(igdbGenres),
      igdbScreenshotId,
      gameId,
    )
    .run();
}

function deriveOptimalPlayerCount(
  modes: Array<{ online_max?: number; online_coop_max?: number; lan_max?: number }>,
  hasSinglePlayer: boolean,
): { min: number | null; max: number | null } {
  if (!modes || modes.length === 0) {
    return { min: null, max: null };
  }
  let max = 0;
  for (const mode of modes) {
    max = Math.max(max, mode.online_max ?? 0, mode.online_coop_max ?? 0, mode.lan_max ?? 0);
  }
  if (max === 0) return { min: null, max: null };
  const min = hasSinglePlayer ? 1 : 2;
  return { min, max };
}
