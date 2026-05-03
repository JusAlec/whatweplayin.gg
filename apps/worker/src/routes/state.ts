import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  groupId: string;
  parts: string[];
}

interface State {
  ratingCache: Record<string, unknown>;
  ownership: Record<string, Record<string, boolean>>;
  prefs: Record<string, unknown>;
  tonight: Record<string, unknown>;
  gameStatus: Record<string, string>;
  gameProgress: Record<string, unknown>;
  sessions: unknown[];
}

export async function dispatchState(ctx: RouteCtx): Promise<Response | null> {
  const { parts, request, env, groupId } = ctx;
  if (parts.length !== 1 || parts[0] !== 'state' || request.method !== 'GET') return null;

  const out: State = {
    ratingCache: {},
    ownership: {},
    prefs: {},
    tonight: {},
    gameStatus: {},
    gameProgress: {},
    sessions: [],
  };

  const list = await env.KV.list({ prefix: `group:${groupId}:` });
  for (const key of list.keys) {
    const value = await env.KV.get(key.name);
    if (value === null) continue;
    const parsed = safeParse(value);
    if (parsed === undefined) continue;
    populate(out, key.name, parsed, groupId);
  }
  out.sessions.sort((a, b) =>
    (b as { startedAt: string }).startedAt.localeCompare((a as { startedAt: string }).startedAt),
  );
  return Response.json(out);
}

function safeParse(v: string): unknown {
  try { return JSON.parse(v); } catch { return undefined; }
}

function populate(out: State, key: string, value: unknown, groupId: string): void {
  const tail = key.replace(`group:${groupId}:`, '');
  let m;
  if ((m = tail.match(/^rating-cache:(.+)$/))) out.ratingCache[m[1]!] = value;
  else if ((m = tail.match(/^person:([^:]+):owns:(.+)$/))) {
    out.ownership[m[1]!] ??= {};
    out.ownership[m[1]!]![m[2]!] = value as boolean;
  } else if ((m = tail.match(/^person:([^:]+):prefs$/))) out.prefs[m[1]!] = value;
  else if ((m = tail.match(/^person:([^:]+):tonight$/))) out.tonight[m[1]!] = value;
  else if ((m = tail.match(/^game-status:(.+)$/))) out.gameStatus[m[1]!] = value as string;
  else if ((m = tail.match(/^game-progress:(.+)$/))) out.gameProgress[m[1]!] = value;
  else if (tail.startsWith('session:')) out.sessions.push(value);
}
