import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  groupId: string;
  parts: string[];
}

export async function dispatchSessions(ctx: RouteCtx): Promise<Response | null> {
  const { parts, request, env, groupId } = ctx;
  if (parts.length !== 1 || parts[0] !== 'sessions') return null;

  if (request.method === 'GET') {
    const list = await env.KV.list({ prefix: `group:${groupId}:session:` });
    const records = await Promise.all(
      list.keys.map(async (k) => JSON.parse((await env.KV.get(k.name))!)),
    );
    records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Response.json(records);
  }
  if (request.method === 'POST') {
    const body = (await safeJson(request)) as Record<string, unknown> | null;
    if (!body) return badRequest('body required');
    if (typeof body.startedAt !== 'string') return badRequest('startedAt required (ISO string)');
    if (!Array.isArray(body.attendees) || body.attendees.length === 0)
      return badRequest('attendees must be non-empty array');
    if (typeof body.gamePicked !== 'string') return badRequest('gamePicked required');

    const key = `group:${groupId}:session:${body.startedAt}`;
    await env.KV.put(key, JSON.stringify(body));
    return new Response('ok');
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

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}
