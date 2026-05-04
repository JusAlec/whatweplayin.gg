import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchLibrary(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'groups' || parts[2] !== 'library' || parts.length !== 3) return null;
  if (request.method !== 'GET') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gid = parts[1]!;
  const memberRow = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const limit = clamp(parseInt(url.searchParams.get('limit') ?? '50', 10), 1, 200);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));
  const filter = url.searchParams.get('filter') ?? 'all';
  const sort = url.searchParams.get('sort') ?? 'name';
  const q = url.searchParams.get('q') ?? '';

  const filterClauses: string[] = [];
  if (filter === 'coop') filterClauses.push('g.has_coop = 1');
  else if (filter === 'pvp') filterClauses.push('g.has_pvp = 1');
  else if (filter === 'single') filterClauses.push('g.has_singleplayer = 1');

  const sortMap: Record<string, string> = {
    name: 'g.name ASC',
    recent: 'maxLastPlayed DESC',
    playtime: 'totalPlaytime DESC',
    owners: 'ownerCount DESC',
  };
  const sortClause = sortMap[sort] ?? sortMap.name;

  const searchClause = q ? `AND LOWER(g.name) LIKE ?` : '';
  const whereExtras = filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';

  const totalBinds: unknown[] = [gid];
  if (q) totalBinds.push(`%${q.toLowerCase()}%`);
  const totalRow = (await env.DB.prepare(
    `SELECT COUNT(DISTINCT g.id) AS n
       FROM games g
       JOIN game_ownership go ON go.game_id = g.id
       JOIN group_members  gm ON gm.user_id = go.user_id
      WHERE gm.group_id = ?
        ${whereExtras}
        ${searchClause}`,
  )
    .bind(...totalBinds)
    .first()) as { n: number };
  const total = totalRow?.n ?? 0;

  const queryBinds: unknown[] = [
    session.user.id, // yourPlaytime
    session.user.id, // yourLastPlayed
    gid,
    session.user.id, // yourVote
    gid, // thumbsUp
    gid, // thumbsDown
    gid, // main where
  ];
  if (q) queryBinds.push(`%${q.toLowerCase()}%`);
  queryBinds.push(limit, offset);

  const result = await env.DB.prepare(
    `SELECT g.*,
            COUNT(DISTINCT go2.user_id) AS ownerCount,
            MAX(go2.last_played_at) AS maxLastPlayed,
            SUM(go2.playtime_minutes) AS totalPlaytime,
            MAX(CASE WHEN go2.user_id = ? THEN go2.playtime_minutes ELSE NULL END) AS yourPlaytime,
            MAX(CASE WHEN go2.user_id = ? THEN go2.last_played_at ELSE NULL END) AS yourLastPlayed,
            (SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = g.id) AS yourVote,
            (SELECT COUNT(*) FROM thumbs WHERE group_id = ? AND game_id = g.id AND vote = 1) AS thumbsUp,
            (SELECT COUNT(*) FROM thumbs WHERE group_id = ? AND game_id = g.id AND vote = -1) AS thumbsDown
       FROM games g
       JOIN game_ownership go ON go.game_id = g.id
       JOIN group_members  gm ON gm.user_id = go.user_id
       JOIN game_ownership go2 ON go2.game_id = g.id
       JOIN group_members  gm2 ON gm2.user_id = go2.user_id AND gm2.group_id = gm.group_id
      WHERE gm.group_id = ?
        ${whereExtras}
        ${searchClause}
      GROUP BY g.id
      ORDER BY ${sortClause}
      LIMIT ? OFFSET ?`,
  )
    .bind(...queryBinds)
    .all();

  const games = (result.results as Record<string, unknown>[]).map((r) => ({
    game: rowToGame(r),
    ownerCount: r.ownerCount as number,
    yourVote: (r.yourVote ?? 0) as -1 | 0 | 1,
    thumbs: { up: r.thumbsUp as number, down: r.thumbsDown as number },
    yourPlaytime: (r.yourPlaytime as number | null) ?? null,
    yourLastPlayed: (r.yourLastPlayed as string | null) ?? null,
  }));

  return jsonStatus({ games, total, limit, offset }, 200);
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
    releaseStatus: r.release_status,
    releaseDate: r.release_date,
    catalogTier: r.catalog_tier,
    metadataSyncedAt: r.metadata_synced_at,
    steamReviewScore: r.steam_review_score,
    steamReviewScoreDesc: r.steam_review_score_desc,
    steamReviewPctPositive: r.steam_review_pct_positive,
    steamReviewCount: r.steam_review_count,
  };
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
