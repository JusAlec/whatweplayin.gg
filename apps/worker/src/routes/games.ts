import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchGames(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'games' || parts.length !== 2) return null;
  if (request.method !== 'GET') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gameId = parts[1]!;
  const url = new URL(request.url);
  const gid = url.searchParams.get('groupId');
  if (!gid) return jsonStatus({ error: 'groupId-required' }, 400);

  const memberRow = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  const gameRow = (await env.DB.prepare('SELECT * FROM games WHERE id = ?')
    .bind(gameId)
    .first()) as Record<string, unknown> | null;
  if (!gameRow) return jsonStatus({ error: 'not-found' }, 404);

  const sizeRow = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?',
  )
    .bind(gid)
    .first()) as { n: number };

  const membersResult = await env.DB.prepare(
    `SELECT u.id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
            go.playtime_minutes AS playtime, go.last_played_at AS lastPlayed
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LEFT JOIN game_ownership go ON go.user_id = u.id AND go.game_id = ?
      WHERE gm.group_id = ?`,
  )
    .bind(gameId, gid)
    .all();

  const members = (membersResult.results as Array<Record<string, unknown>>)
    .filter((r) => r.playtime != null)
    .map((r) => ({
      userId: r.userId as string,
      displayName: r.displayName as string,
      avatarUrl: (r.avatarUrl as string | null) ?? null,
      playtime: (r.playtime as number) ?? 0,
      lastPlayed: (r.lastPlayed as string | null) ?? null,
    }));

  const yourVoteRow = (await env.DB.prepare(
    'SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
  )
    .bind(gid, session.user.id, gameId)
    .first()) as { vote?: number } | null;

  const thumbsAggRow = (await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)  AS up,
       SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
     FROM thumbs WHERE group_id = ? AND game_id = ?`,
  )
    .bind(gid, gameId)
    .first()) as { up: number | null; down: number | null };

  const yourMember = members.find((m) => m.userId === session.user.id);

  return jsonStatus(
    {
      game: rowToGame(gameRow),
      groupContext: {
        ownerCount: members.length,
        groupSize: sizeRow.n,
        members,
        yourVote: (yourVoteRow?.vote ?? 0) as -1 | 0 | 1,
        thumbs: { up: thumbsAggRow.up ?? 0, down: thumbsAggRow.down ?? 0 },
        yourPlaytime: yourMember?.playtime ?? null,
        yourLastPlayed: yourMember?.lastPlayed ?? null,
      },
    },
    200,
  );
}

function rowToGame(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    steamAppId: r.steam_app_id,
    coverUrl: r.cover_url,
    hasSingleplayer: r.has_singleplayer === 1,
    hasCoop: r.has_coop === 1,
    hasPvp: r.has_pvp === 1,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    optimalMin: r.optimal_min ?? null,
    optimalMax: r.optimal_max ?? null,
    releaseDate: r.release_date,
    metadataSyncedAt: r.metadata_synced_at,
    catalogTier: r.catalog_tier,
    steamReviewScore: r.steam_review_score,
    steamReviewScoreDesc: r.steam_review_score_desc,
    steamReviewPctPositive: r.steam_review_pct_positive,
    steamReviewCount: r.steam_review_count,
    description: r.description ?? null,
    genres: r.genres ? JSON.parse(r.genres as string) : [],
    igdbScreenshotId: r.igdb_screenshot_id ?? null,
  };
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
