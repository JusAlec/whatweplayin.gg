import { rankByThumbs } from '@wwp/recommender';
import { getSessionFromRequest } from '../auth/session-helpers.js';
import { flagOff, readNumber } from '../lib/flags.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchRecommendations(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'groups' || parts[2] !== 'recommendations' || parts.length !== 3) return null;
  if (request.method !== 'GET') return null;

  if (flagOff(env, 'WWP_FEAT_RECOMMENDATIONS')) {
    return jsonStatus({ error: 'recommendations-disabled' }, 503);
  }

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gid = parts[1]!;
  const memberRow = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  const weights = {
    thumbs: readNumber(env, 'WWP_WEIGHT_THUMBS', 0.5),
    ownership: readNumber(env, 'WWP_WEIGHT_OWNERSHIP', 0.3),
    novelty: readNumber(env, 'WWP_WEIGHT_NOVELTY', 0.2),
  };
  const limit = readNumber(env, 'WWP_RECOMMENDATIONS_LIMIT', 5);
  const vetoDays = readNumber(env, 'WWP_THUMBS_DOWN_VETO_DAYS', 7);

  const sizeRow = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?',
  )
    .bind(gid)
    .first()) as { n: number };
  const groupSize = sizeRow.n;

  const candidatesResult = await env.DB.prepare(
    `SELECT DISTINCT g.*
       FROM games g
       JOIN game_ownership go ON go.game_id = g.id
       JOIN group_members  gm ON gm.user_id = go.user_id
      WHERE gm.group_id = ?
        AND g.release_status != 'maintenance-mode'
        AND (? = 1 OR g.has_coop = 1 OR g.has_pvp = 1)
        AND NOT EXISTS (
          SELECT 1 FROM thumbs t
           WHERE t.group_id = ? AND t.game_id = g.id
             AND t.vote = -1
             AND t.voted_at > datetime('now', ?)
        )`,
  )
    .bind(gid, groupSize === 1 ? 1 : 0, gid, `-${vetoDays} days`)
    .all();
  const candidates = (candidatesResult.results as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    steamReviewPctPositive: (r.steam_review_pct_positive as number | null) ?? null,
    metadataSyncedAt: (r.metadata_synced_at as string | null) ?? null,
  }));

  if (candidates.length === 0) {
    return jsonStatus(
      {
        picks: [],
        generatedAt: new Date().toISOString(),
        weightsUsed: weights,
        coldStart: true,
      },
      200,
    );
  }

  const ownershipResult = await env.DB.prepare(
    `SELECT go.game_id, COUNT(DISTINCT go.user_id) AS ownerCount, MAX(go.last_played_at) AS maxLastPlayed
       FROM game_ownership go
       JOIN group_members gm ON gm.user_id = go.user_id
      WHERE gm.group_id = ?
      GROUP BY go.game_id`,
  )
    .bind(gid)
    .all();
  const ownership = new Map<string, { ownerCount: number; maxLastPlayed: string | null }>();
  for (const r of ownershipResult.results as Record<string, unknown>[]) {
    ownership.set(r.game_id as string, {
      ownerCount: r.ownerCount as number,
      maxLastPlayed: (r.maxLastPlayed as string | null) ?? null,
    });
  }

  const thumbsResult = await env.DB.prepare(
    'SELECT user_id, game_id, vote FROM thumbs WHERE group_id = ?',
  )
    .bind(gid)
    .all();
  const thumbs = new Map<string, Array<{ userId: string; vote: -1 | 1 }>>();
  for (const r of thumbsResult.results as Record<string, unknown>[]) {
    const arr = thumbs.get(r.game_id as string) ?? [];
    arr.push({ userId: r.user_id as string, vote: r.vote as -1 | 1 });
    thumbs.set(r.game_id as string, arr);
  }

  const result = rankByThumbs({
    group: { id: gid, size: groupSize },
    candidates,
    thumbs,
    ownership,
    weights,
    now: new Date(),
  });

  const top = result.picks.slice(0, limit);
  const picks = await Promise.all(
    top.map(async (p) => {
      const fullGame = await env.DB.prepare('SELECT * FROM games WHERE id = ?')
        .bind(p.gameId)
        .first();
      const yourVoteRow = await env.DB.prepare(
        'SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
      )
        .bind(gid, session.user.id, p.gameId)
        .first();
      const own = ownership.get(p.gameId) ?? { ownerCount: 0, maxLastPlayed: null };
      const gameThumbs = thumbs.get(p.gameId) ?? [];
      return {
        game: rowToGame(fullGame as Record<string, unknown>),
        score: p.score,
        breakdown: p.breakdown,
        flags: p.flags,
        ownerCount: own.ownerCount,
        groupSize,
        thumbs: {
          up: gameThumbs.filter((t) => t.vote === 1).length,
          down: gameThumbs.filter((t) => t.vote === -1).length,
        },
        yourVote: ((yourVoteRow as { vote?: number } | null)?.vote ?? 0) as -1 | 0 | 1,
      };
    }),
  );

  return jsonStatus(
    {
      picks,
      generatedAt: new Date().toISOString(),
      weightsUsed: weights,
      coldStart: result.coldStart,
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

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
