import { dispatchAuth } from './routes/auth.js';
import { dispatchConfig } from './routes/config.js';
import { dispatchGroups } from './routes/groups.js';
import { dispatchInvites, dispatchInviteByCode } from './routes/invites.js';
import { dispatchMe } from './routes/me.js';
import { dispatchKvCrud } from './routes/kv-crud.js';
import { dispatchVotes } from './routes/votes.js';
import { dispatchSessions } from './routes/sessions.js';
import { dispatchState } from './routes/state.js';
import { dispatchThumbs } from './routes/thumbs.js';
import { dispatchLibrary } from './routes/library.js';
import { dispatchRecommendations } from './routes/recommendations.js';
import { checkAuth as checkGroupSecret } from './auth.js';

export interface Env {
  KV: KVNamespace;
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  SITE_ORIGIN?: string;
  SESSION_COOKIE_DOMAIN?: string;
  RESEND_API_KEY?: string;
  STEAM_API_KEY?: string;
  IGDB_CLIENT_ID?: string;
  IGDB_CLIENT_SECRET?: string;

  // v2.1 behavior toggles (read with `=== 'true'` semantics)
  WWP_FEAT_AUTOSYNC_ON_LOGIN?: string;
  WWP_FEAT_THUMBS?: string;
  WWP_FEAT_RECOMMENDATIONS?: string;
  WWP_FEAT_STEAM_RATINGS?: string;

  // v2.1 tunables
  WWP_AUTOSYNC_STALENESS_HOURS?: string;
  WWP_WEIGHT_THUMBS?: string;
  WWP_WEIGHT_OWNERSHIP?: string;
  WWP_WEIGHT_NOVELTY?: string;
  WWP_RECOMMENDATIONS_LIMIT?: string;
  WWP_THUMBS_DOWN_VETO_DAYS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    // /api/auth/* routes (no group-secret check; uses session cookie)
    if (parts[0] === 'api') {
      const apiParts = parts.slice(1);
      const authResp = await dispatchAuth({
        request,
        env,
        parts: apiParts,
        baseUrl: env.BETTER_AUTH_URL ?? `${url.protocol}//${url.host}`,
        ctx,
      });
      if (authResp) return withCors(authResp, request, env);
      const configResp = await dispatchConfig({ request, env, parts: apiParts });
      if (configResp) return withCors(configResp, request, env);
      const groupsResp = await dispatchGroups({ request, env, parts: apiParts });
      if (groupsResp) return withCors(groupsResp, request, env);
      const meResp = await dispatchMe({ request, env, parts: apiParts, ctx });
      if (meResp) return withCors(meResp, request, env);
      const invitesResp = await dispatchInvites({ request, env, parts: apiParts });
      if (invitesResp) return withCors(invitesResp, request, env);
      const inviteByCodeResp = await dispatchInviteByCode({ request, env, parts: apiParts });
      if (inviteByCodeResp) return withCors(inviteByCodeResp, request, env);
      const thumbsResp = await dispatchThumbs({ request, env, parts: apiParts });
      if (thumbsResp) return withCors(thumbsResp, request, env);
      const libraryResp = await dispatchLibrary({ request, env, parts: apiParts });
      if (libraryResp) return withCors(libraryResp, request, env);
      const recommendationsResp = await dispatchRecommendations({
        request,
        env,
        parts: apiParts,
      });
      if (recommendationsResp) return withCors(recommendationsResp, request, env);
      return withCors(new Response('not found', { status: 404 }), request, env);
    }

    // v1 /groups/<gid>/* routes — group-secret auth (preserved for backwards compat)
    if (parts[0] === 'groups' && parts.length >= 2) {
      const groupId = parts[1]!;
      const authFail = await checkGroupSecret(request, env, groupId);
      if (authFail) return withCors(authFail, request, env);
      const inner = parts.slice(2);
      const innerCtx = { request, env, groupId, parts: inner };
      const stateResp = await dispatchState(innerCtx);
      if (stateResp) return withCors(stateResp, request, env);
      const voteResp = await dispatchVotes(innerCtx);
      if (voteResp) return withCors(voteResp, request, env);
      const sessionResp = await dispatchSessions(innerCtx);
      if (sessionResp) return withCors(sessionResp, request, env);
      const crudResponse = await dispatchKvCrud(innerCtx);
      if (crudResponse) return withCors(crudResponse, request, env);
      return withCors(new Response('not found', { status: 404 }), request, env);
    }

    if (parts.length === 0)
      return withCors(new Response('WhatWePlayin worker (v2.0)', { status: 200 }), request, env);
    return withCors(new Response('not found', { status: 404 }), request, env);
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(request: Request, env: Env): HeadersInit {
  const requestOrigin = request.headers.get('origin') ?? '';
  const siteOrigin = env.SITE_ORIGIN ?? 'https://whatweplayin.gg';
  const allowedOrigins = new Set([
    siteOrigin,
    'http://localhost:4321', // astro dev
    'http://localhost:3000',
  ]);
  const allowOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : siteOrigin;
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-group-secret',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function withCors(res: Response, request: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v as string);
  return new Response(res.body, { status: res.status, headers });
}
