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
