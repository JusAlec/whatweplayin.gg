import type { Env } from '../index.js';

const VOTED_DIMS = ['combat', 'grind', 'buildingDepth', 'commitmentLevel', 'pvpFocus', 'sessionLength'];

interface RouteCtx {
  request: Request;
  env: Env;
  groupId: string;
  parts: string[];
}

export async function dispatchVotes(ctx: RouteCtx): Promise<Response | null> {
  const { parts, request, env, groupId } = ctx;
  // /votes/<userId>/<gameId>/<dim>
  if (parts.length !== 4 || parts[0] !== 'votes') return null;
  const userId = parts[1]!;
  const gameId = parts[2]!;
  const dim = parts[3]!;
  if (!VOTED_DIMS.includes(dim)) return badRequest(`unknown dim: ${dim}`);

  const key = `group:${groupId}:vote:${userId}:${gameId}:${dim}`;
  if (request.method === 'GET') {
    const raw = await env.KV.get(key);
    return Response.json(raw ? JSON.parse(raw) : null);
  }
  if (request.method === 'PUT') {
    const body = (await safeJson(request)) as { value?: number } | null;
    if (!body || typeof body.value !== 'number' || body.value < 1 || body.value > 5)
      return badRequest('value must be number 1..5');

    const record = { value: body.value, timestamp: new Date().toISOString() };
    await env.KV.put(key, JSON.stringify(record));
    await recomputeRatingCache(env, groupId, gameId);
    return new Response('ok');
  }
  return null;
}

async function recomputeRatingCache(env: Env, groupId: string, gameId: string): Promise<void> {
  const cache: Record<string, { avg: number; variance: number; n: number }> = {};
  for (const dim of VOTED_DIMS) {
    const list = await env.KV.list({ prefix: `group:${groupId}:vote:` });
    const values: number[] = [];
    for (const key of list.keys) {
      const m = key.name.match(/^group:[^:]+:vote:[^:]+:([^:]+):(.+)$/);
      if (!m || m[1] !== gameId || m[2] !== dim) continue;
      const raw = await env.KV.get(key.name);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { value: number };
      values.push(parsed.value);
    }
    if (values.length === 0) {
      cache[dim] = { avg: 0, variance: 0, n: 0 };
      continue;
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
    cache[dim] = { avg, variance, n: values.length };
  }
  await env.KV.put(
    `group:${groupId}:rating-cache:${gameId}`,
    JSON.stringify({ ...cache, updatedAt: new Date().toISOString() }),
  );
}

async function safeJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return null; }
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
}
