import { z } from 'zod';
import { Db } from '../lib/d1-client.js';
import { getSessionFromRequest } from '../auth/session-helpers.js';
import { flagOff } from '../lib/flags.js';
import type { Env } from '../index.js';

const ThumbBodySchema = z.object({ vote: z.union([z.literal(-1), z.literal(1)]) });

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[]; // ['groups', '<gid>', 'games', '<gameId>', 'thumb']
}

export async function dispatchThumbs(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'groups' || parts[2] !== 'games' || parts[4] !== 'thumb') return null;
  if (parts.length !== 5) return null;

  if (flagOff(env, 'WWP_FEAT_THUMBS')) {
    return jsonStatus({ error: 'thumbs-disabled' }, 503);
  }

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gid = parts[1]!;
  const gameId = parts[3]!;

  const memberRow = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  const ownedRow = await env.DB.prepare(
    `SELECT 1 FROM game_ownership go
       JOIN group_members gm ON gm.user_id = go.user_id
      WHERE gm.group_id = ? AND go.game_id = ?
      LIMIT 1`,
  )
    .bind(gid, gameId)
    .first();
  if (!ownedRow) return jsonStatus({ error: 'game-not-in-group-library' }, 404);

  if (request.method === 'PUT') {
    const body = await safeJson(request);
    const parsed = ThumbBodySchema.safeParse(body);
    if (!parsed.success) return jsonStatus({ error: 'invalid input' }, 400);
    const dbi = new Db(env.DB);
    const result = await dbi.thumbs.upsert(gid, session.user.id, gameId, parsed.data.vote);
    return jsonStatus({ ok: true, ...result }, 200);
  }

  if (request.method === 'DELETE') {
    const dbi = new Db(env.DB);
    await dbi.thumbs.delete(gid, session.user.id, gameId);
    return jsonStatus({ ok: true }, 200);
  }

  return null;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
