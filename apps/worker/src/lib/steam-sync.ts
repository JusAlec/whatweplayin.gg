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

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  enrichmentEnabled?: boolean; // default true
  enrichmentParallelism?: number; // default 6
}

export interface SyncResult {
  gamesAdded: number;
  gamesUpdated: number;
  ownershipRemoved: number;
  enrichmentDeferred: number;
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

    const lastPlayed = g.rtimeLastPlayed
      ? new Date(g.rtimeLastPlayed * 1000).toISOString()
      : null;
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

  return { gamesAdded, gamesUpdated, ownershipRemoved, enrichmentDeferred, syncedAt };
}

async function removeStaleOwnership(
  env: Env,
  userId: string,
  returnedIds: string[],
): Promise<number> {
  // Count first (so the result is reliable across D1 driver versions).
  const placeholders = returnedIds.length > 0 ? returnedIds.map(() => '?').join(',') : null;
  const countQuery = placeholders
    ? `SELECT COUNT(*) AS n FROM game_ownership WHERE user_id = ? AND game_id NOT IN (${placeholders})`
    : `SELECT COUNT(*) AS n FROM game_ownership WHERE user_id = ?`;
  const countRow = (await env.DB.prepare(countQuery)
    .bind(userId, ...returnedIds)
    .first()) as { n: number } | null;
  const n = countRow?.n ?? 0;
  if (n === 0) return 0;

  const deleteQuery = placeholders
    ? `DELETE FROM game_ownership WHERE user_id = ? AND game_id NOT IN (${placeholders})`
    : `DELETE FROM game_ownership WHERE user_id = ?`;
  await env.DB.prepare(deleteQuery)
    .bind(userId, ...returnedIds)
    .run();
  return n;
}

async function enrichNewGames(
  _env: Env,
  _candidateGameIds: string[],
  _opts: SyncOptions,
): Promise<number> {
  // Stub for Task 11.
  // Reference unused imports so they remain available when Task 11 lands.
  void fetchAppDetails;
  void fetchAppReviews;
  void isAppidSkipped;
  void markAppidSkipped;
  return 0;
}
