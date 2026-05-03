import type { Env } from '../index.js';

const STATUSES = ['not_started', 'in_progress', 'shelved', 'completed', 'pending_update'];

interface RouteCtx {
  request: Request;
  env: Env;
  groupId: string;
  parts: string[]; // segments after `/groups/<gid>`
}

type Handler = (ctx: RouteCtx) => Promise<Response>;

const handlers: { match: (parts: string[], method: string) => boolean; handler: Handler }[] = [
  // /people/<userId>/prefs
  {
    match: (p, m) =>
      p.length === 3 && p[0] === 'people' && p[2] === 'prefs' && (m === 'GET' || m === 'PUT'),
    handler: async ({ request, env, groupId, parts }) => {
      const userId = parts[1]!;
      const key = `group:${groupId}:person:${userId}:prefs`;
      if (request.method === 'GET') return jsonRead(env, key);
      const body = await safeJson(request);
      if (!body || !validateStablePrefs(body)) return badRequest('invalid prefs payload');
      await env.KV.put(key, JSON.stringify(body));
      return new Response('ok', { status: 200 });
    },
  },
  // /people/<userId>/owns/<gameId>
  {
    match: (p, m) =>
      p.length === 4 && p[0] === 'people' && p[2] === 'owns' && (m === 'GET' || m === 'PUT'),
    handler: async ({ request, env, groupId, parts }) => {
      const userId = parts[1]!;
      const gameId = parts[3]!;
      const key = `group:${groupId}:person:${userId}:owns:${gameId}`;
      if (request.method === 'GET') return jsonRead(env, key);
      const body = await safeJson(request);
      if (typeof body !== 'boolean') return badRequest('owns must be boolean');
      await env.KV.put(key, JSON.stringify(body));
      return new Response('ok', { status: 200 });
    },
  },
  // /people/<userId>/tonight
  {
    match: (p, m) =>
      p.length === 3 && p[0] === 'people' && p[2] === 'tonight' && (m === 'GET' || m === 'PUT'),
    handler: async ({ request, env, groupId, parts }) => {
      const userId = parts[1]!;
      const key = `group:${groupId}:person:${userId}:tonight`;
      if (request.method === 'GET') return jsonRead(env, key);
      const body = await safeJson(request);
      if (!body || typeof body !== 'object') return badRequest('tonight must be object');
      const t = body as Record<string, unknown>;
      if (typeof t.atTimestamp !== 'string') return badRequest('tonight.atTimestamp required');
      await env.KV.put(key, JSON.stringify(t));
      return new Response('ok', { status: 200 });
    },
  },
  // /games/<gameId>/status
  {
    match: (p, m) =>
      p.length === 3 && p[0] === 'games' && p[2] === 'status' && (m === 'GET' || m === 'PUT'),
    handler: async ({ request, env, groupId, parts }) => {
      const gameId = parts[1]!;
      const key = `group:${groupId}:game-status:${gameId}`;
      if (request.method === 'GET') return jsonRead(env, key);
      const body = await safeJson(request);
      if (typeof body !== 'string' || !STATUSES.includes(body)) return badRequest('invalid status');
      await env.KV.put(key, JSON.stringify(body));
      return new Response('ok', { status: 200 });
    },
  },
  // /games/<gameId>/progress
  {
    match: (p, m) =>
      p.length === 3 && p[0] === 'games' && p[2] === 'progress' && (m === 'GET' || m === 'PUT'),
    handler: async ({ request, env, groupId, parts }) => {
      const gameId = parts[1]!;
      const key = `group:${groupId}:game-progress:${gameId}`;
      if (request.method === 'GET') return jsonRead(env, key);
      const body = await safeJson(request);
      if (!body || typeof body !== 'object') return badRequest('progress must be object');
      await env.KV.put(key, JSON.stringify(body));
      return new Response('ok', { status: 200 });
    },
  },
];

export async function dispatchKvCrud(ctx: RouteCtx): Promise<Response | null> {
  for (const { match, handler } of handlers) {
    if (match(ctx.parts, ctx.request.method)) return handler(ctx);
  }
  return null;
}

async function jsonRead(env: Env, key: string): Promise<Response> {
  const raw = await env.KV.get(key);
  return Response.json(raw ? JSON.parse(raw) : null);
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

function validateStablePrefs(body: unknown): body is Record<string, number> {
  if (!body || typeof body !== 'object') return false;
  const dims = ['combat', 'grind', 'buildingDepth', 'commitmentLevel', 'pvpFocus', 'sessionLength'];
  const obj = body as Record<string, unknown>;
  for (const d of dims) {
    if (typeof obj[d] !== 'number' || (obj[d] as number) < 1 || (obj[d] as number) > 5)
      return false;
  }
  return true;
}
