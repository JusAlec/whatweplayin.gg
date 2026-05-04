import { dispatchAuth } from './routes/auth.js';
import { dispatchGroups } from './routes/groups.js';
import { dispatchInvites } from './routes/invites.js';
import { dispatchMe } from './routes/me.js';
import { dispatchKvCrud } from './routes/kv-crud.js';
import { dispatchVotes } from './routes/votes.js';
import { dispatchSessions } from './routes/sessions.js';
import { dispatchState } from './routes/state.js';
import { checkAuth as checkGroupSecret } from './auth.js';

export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  STEAM_API_KEY?: string;
  IGDB_CLIENT_ID?: string;
  IGDB_CLIENT_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // /api/auth/* routes (no group-secret check; uses session cookie)
    if (parts[0] === 'api') {
      const apiParts = parts.slice(1);
      const authResp = await dispatchAuth({
        request,
        env,
        parts: apiParts,
        baseUrl: env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`,
      });
      if (authResp) return withCors(authResp);
      const groupsResp = await dispatchGroups({ request, env, parts: apiParts });
      if (groupsResp) return withCors(groupsResp);
      const meResp = await dispatchMe({ request, env, parts: apiParts });
      if (meResp) return withCors(meResp);
      const invitesResp = await dispatchInvites({ request, env, parts: apiParts });
      if (invitesResp) return withCors(invitesResp);
      return withCors(new Response('not found', { status: 404 }));
    }

    // v1 /groups/<gid>/* routes — group-secret auth (preserved for backwards compat)
    if (parts[0] === 'groups' && parts.length >= 2) {
      const groupId = parts[1]!;
      const authFail = await checkGroupSecret(request, env, groupId);
      if (authFail) return withCors(authFail);
      const inner = parts.slice(2);
      const innerCtx = { request, env, groupId, parts: inner };
      const stateResp = await dispatchState(innerCtx);
      if (stateResp) return withCors(stateResp);
      const voteResp = await dispatchVotes(innerCtx);
      if (voteResp) return withCors(voteResp);
      const sessionResp = await dispatchSessions(innerCtx);
      if (sessionResp) return withCors(sessionResp);
      const crudResponse = await dispatchKvCrud(innerCtx);
      if (crudResponse) return withCors(crudResponse);
      return withCors(new Response('not found', { status: 404 }));
    }

    if (parts.length === 0)
      return withCors(new Response('WhatWePlayin worker (v2.0)', { status: 200 }));
    return withCors(new Response('not found', { status: 404 }));
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-group-secret',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v as string);
  return new Response(res.body, { status: res.status, headers });
}
