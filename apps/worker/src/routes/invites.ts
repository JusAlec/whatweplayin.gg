import { CreateInviteRequestSchema } from '@wwp/auth-shared';
import { Db } from '../lib/d1-client.js';
import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[]; // /api/groups/:gid/invites/...
}

const INVITE_CODE_LEN = 8;
const INVITE_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => INVITE_CHARSET[b % INVITE_CHARSET.length]).join('');
}

export async function dispatchInvites(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'groups' || parts[2] !== 'invites') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gid = parts[1]!;

  const memberRow = await env.DB
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  // POST /api/groups/:gid/invites — create invite
  if (parts.length === 3 && request.method === 'POST') {
    const body = await safeJson(request);
    const parsed = CreateInviteRequestSchema.safeParse(body ?? {});
    if (!parsed.success) return jsonStatus({ error: 'invalid input' }, 400);

    const expiresInDays = parsed.data.expiresInDays ?? 7;
    const maxUses = parsed.data.maxUses ?? 0;
    const code = generateInviteCode();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();

    await new Db(env.DB).groupInvites.insert({
      code,
      groupId: gid,
      createdBy: session.user.id,
      expiresAt,
      maxUses,
      useCount: 0,
      createdAt: now,
    });

    return jsonStatus({ code, expiresAt, maxUses }, 200);
  }

  // GET /api/groups/:gid/invites — list active invites
  if (parts.length === 3 && request.method === 'GET') {
    const result = await env.DB
      .prepare(
        `SELECT code, expires_at, max_uses, use_count, created_at
           FROM group_invites
          WHERE group_id = ? AND expires_at > ?
          ORDER BY created_at DESC`,
      )
      .bind(gid, new Date().toISOString())
      .all();
    const invites = (result.results as Record<string, unknown>[]).map((r) => ({
      code: r.code as string,
      expiresAt: r.expires_at as string,
      maxUses: r.max_uses as number,
      useCount: r.use_count as number,
      createdAt: r.created_at as string,
    }));
    return jsonStatus({ invites }, 200);
  }

  // DELETE /api/groups/:gid/invites/:code — revoke
  if (parts.length === 4 && request.method === 'DELETE') {
    const code = parts[3]!;
    await env.DB
      .prepare('DELETE FROM group_invites WHERE group_id = ? AND code = ?')
      .bind(gid, code)
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
