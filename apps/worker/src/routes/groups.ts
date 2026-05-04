import { ulid } from 'ulid';
import { CreateGroupRequestSchema } from '@wwp/auth-shared';
import { Db } from '../lib/d1-client.js';
import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

const DEFAULT_WEIGHTS = {
  preferenceMatch: 0.4,
  groupFit: 0.25,
  sessionFit: 0.2,
  novelty: 0.15,
};

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchGroups(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'groups') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  // POST /api/groups → create group
  if (parts.length === 1 && request.method === 'POST') {
    const body = await safeJson(request);
    const parsed = CreateGroupRequestSchema.safeParse(body);
    if (!parsed.success)
      return jsonStatus({ error: 'invalid input', details: parsed.error.format() }, 400);

    const dbi = new Db(env.DB);
    const id = ulid().toLowerCase();
    const now = new Date().toISOString();
    const weights = parsed.data.scoringWeights ?? DEFAULT_WEIGHTS;

    await dbi.groups.insert({
      id,
      displayName: parsed.data.displayName,
      creatorId: session.user.id,
      scoringWeights: weights,
      customCompletionGoals: null,
      createdAt: now,
      memberCount: 1,
    });
    await dbi.groupMembers.insert({
      groupId: id,
      userId: session.user.id,
      role: 'creator',
      joinedAt: now,
      weight: 1.0,
      stablePrefs: null,
    });

    return jsonStatus({ id, displayName: parsed.data.displayName }, 200);
  }

  // GET /api/groups → list user's groups
  if (parts.length === 1 && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT g.id, g.display_name, g.created_at, gm.role
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE gm.user_id = ?
          ORDER BY gm.joined_at DESC`,
    )
      .bind(session.user.id)
      .all();
    const groups = (result.results as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      displayName: r.display_name as string,
      createdAt: r.created_at as string,
      role: r.role as string,
    }));
    return jsonStatus({ groups }, 200);
  }

  // GET /api/groups/:gid
  if (parts.length === 2 && request.method === 'GET') {
    const gid = parts[1]!;
    const dbi = new Db(env.DB);

    const memberRow = await env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    )
      .bind(gid, session.user.id)
      .first();
    if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

    const group = await dbi.groups.getById(gid);
    if (!group) return jsonStatus({ error: 'not found' }, 404);

    // JOIN users to include displayName + avatarUrl on each member.
    const memberRows = await env.DB.prepare(
      `SELECT gm.user_id, gm.role, gm.joined_at, gm.weight, gm.stable_prefs,
              u.display_name, u.avatar_url
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?
        ORDER BY gm.joined_at ASC`,
    )
      .bind(gid)
      .all();
    const members = (memberRows.results as Record<string, unknown>[]).map((r) => ({
      groupId: gid,
      userId: r.user_id as string,
      role: r.role as string,
      joinedAt: r.joined_at as string,
      weight: r.weight as number,
      stablePrefs: r.stable_prefs ? JSON.parse(r.stable_prefs as string) : null,
      displayName: r.display_name as string,
      avatarUrl: (r.avatar_url as string | null) ?? null,
    }));
    return jsonStatus({ group, members }, 200);
  }

  // PATCH /api/groups/:gid → creator-only
  if (parts.length === 2 && request.method === 'PATCH') {
    const gid = parts[1]!;
    const memberRow = (await env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    )
      .bind(gid, session.user.id)
      .first()) as { role?: string } | null;
    if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);
    if (memberRow.role !== 'creator') return jsonStatus({ error: 'forbidden — creator only' }, 403);

    const body = await safeJson(request);
    const parsed = CreateGroupRequestSchema.partial().safeParse(body);
    if (!parsed.success) return jsonStatus({ error: 'invalid input' }, 400);

    const updates: string[] = [];
    const binds: unknown[] = [];
    if (parsed.data.displayName !== undefined) {
      updates.push('display_name = ?');
      binds.push(parsed.data.displayName);
    }
    if (parsed.data.scoringWeights !== undefined) {
      updates.push('scoring_weights = ?');
      binds.push(JSON.stringify(parsed.data.scoringWeights));
    }
    if (updates.length === 0) return jsonStatus({ error: 'no fields to update' }, 400);

    binds.push(gid);
    await env.DB.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
    return jsonStatus({ ok: true }, 200);
  }

  // DELETE /api/groups/:gid → creator only
  if (parts.length === 2 && request.method === 'DELETE') {
    const gid = parts[1]!;
    const memberRow = (await env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    )
      .bind(gid, session.user.id)
      .first()) as { role?: string } | null;
    if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);
    if (memberRow.role !== 'creator') return jsonStatus({ error: 'forbidden — creator only' }, 403);

    await env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(gid).run();
    // group_members + group_invites cascade via FK ON DELETE CASCADE
    return jsonStatus({ ok: true }, 200);
  }

  // POST /api/groups/:gid/leave
  if (parts.length === 3 && parts[2] === 'leave' && request.method === 'POST') {
    const gid = parts[1]!;
    const memberRow = (await env.DB.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    )
      .bind(gid, session.user.id)
      .first()) as { role?: string } | null;
    if (!memberRow) return jsonStatus({ error: 'not a member' }, 403);
    if (memberRow.role === 'creator') {
      return jsonStatus({ error: 'creators cannot leave; delete the group instead' }, 409);
    }

    await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind(gid, session.user.id)
      .run();
    await env.DB.prepare('UPDATE groups SET member_count = member_count - 1 WHERE id = ?')
      .bind(gid)
      .run();
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
