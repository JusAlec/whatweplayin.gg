import { ulid } from 'ulid';
import { z } from 'zod';
import { Db } from '../lib/d1-client.js';
import {
  generateMagicLinkToken,
  validateMagicLinkToken,
} from '../auth/magic-link.js';
import {
  createSessionForUser,
  sessionCookie,
  clearSessionCookie,
} from '../auth/session-helpers.js';
import {
  buildSteamLoginUrl,
  verifySteamOpenIDResponse,
  fetchSteamProfile,
} from '../auth/steam-openid.js';
import type { Env } from '../index.js';

const MagicRequestSchema = z.object({ email: z.string().email() });

interface AuthCtx {
  request: Request;
  env: Env;
  parts: string[]; // segments after `/api/`
  baseUrl: string;
}

export async function dispatchAuth(ctx: AuthCtx): Promise<Response | null> {
  const { request, env, parts, baseUrl } = ctx;
  if (parts[0] !== 'auth') return null;
  const sub = parts.slice(1);

  // POST /api/auth/magic/request
  if (sub[0] === 'magic' && sub[1] === 'request' && request.method === 'POST') {
    const body = await safeJson(request);
    const parsed = MagicRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest('invalid email');
    const token = await generateMagicLinkToken(env.DB, parsed.data.email);
    // Email sending wired in Batch 5 (Resend integration); for now return token in dev for testing
    return json({ ok: true, token: __DEV__() ? token : undefined });
  }

  // GET /api/auth/callback/magic?token=...
  if (sub[0] === 'callback' && sub[1] === 'magic' && request.method === 'GET') {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return new Response('missing token', { status: 400 });

    const email = await validateMagicLinkToken(env.DB, token);
    if (!email) return new Response('expired or invalid', { status: 410 });

    const dbi = new Db(env.DB);
    let user = await dbi.users.getByEmail(email);
    if (!user) {
      const now = new Date().toISOString();
      const id = ulid();
      const displayName = email.split('@')[0] ?? 'User';
      await dbi.users.insert({
        id,
        email,
        emailVerified: true,
        displayName,
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      });
      user = await dbi.users.getById(id);
    }
    if (!user) return new Response('user-create failed', { status: 500 });

    const sessionId = await createSessionForUser(env.DB, user.id);

    return new Response(null, {
      status: 302,
      headers: {
        location: '/who',
        'set-cookie': sessionCookie(sessionId),
      },
    });
  }

  // GET /api/auth/login/steam → redirect to Steam OpenID
  if (sub[0] === 'login' && sub[1] === 'steam' && request.method === 'GET') {
    const loginUrl = buildSteamLoginUrl({
      realm: baseUrl,
      returnTo: `${baseUrl}/api/auth/callback/steam`,
    });
    return new Response(null, { status: 302, headers: { location: loginUrl } });
  }

  // GET /api/auth/callback/steam — verify + create user + session
  if (sub[0] === 'callback' && sub[1] === 'steam' && request.method === 'GET') {
    const callbackUrl = new URL(request.url);
    const steamId = await verifySteamOpenIDResponse(callbackUrl);
    if (!steamId) return new Response('Steam verification failed', { status: 401 });

    const dbi = new Db(env.DB);

    const existing = (await env.DB
      .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
      .bind('steam', steamId)
      .first()) as { user_id?: string } | null;

    let userId: string;
    if (existing?.user_id) {
      userId = existing.user_id;
    } else {
      const profile = env.STEAM_API_KEY
        ? await fetchSteamProfile(steamId, env.STEAM_API_KEY)
        : null;
      const now = new Date().toISOString();
      userId = ulid();
      await dbi.users.insert({
        id: userId,
        email: null,
        emailVerified: false,
        displayName: profile?.personaname ?? `Steam ${steamId.slice(-4)}`,
        avatarUrl: profile?.avatarfull ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await env.DB
        .prepare(
          'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          ulid(),
          userId,
          'steam',
          steamId,
          profile ? JSON.stringify(profile) : null,
          now,
        )
        .run();
    }

    const sessionId = await createSessionForUser(env.DB, userId);
    return new Response(null, {
      status: 302,
      headers: {
        location: '/who',
        'set-cookie': sessionCookie(sessionId),
      },
    });
  }

  // POST /api/auth/logout
  if (sub[0] === 'logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': clearSessionCookie(),
      },
    });
  }

  return null;
}

async function safeJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return null; }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

function __DEV__(): boolean {
  // wrangler dev sets this; true in tests
  return true;
}
