import { ulid } from 'ulid';
import { z } from 'zod';
import { Db } from '../lib/d1-client.js';
import { generateMagicLinkToken, validateMagicLinkToken } from '../auth/magic-link.js';
import {
  createSessionForUser,
  getSessionFromRequest,
  sessionCookie,
  clearSessionCookie,
} from '../auth/session-helpers.js';
import {
  buildSteamLoginUrl,
  verifySteamOpenIDResponse,
  fetchSteamProfile,
} from '../auth/steam-openid.js';
import { sendMagicLinkEmail } from '../lib/resend.js';
import type { Env } from '../index.js';

const MagicRequestSchema = z.object({ email: z.string().email() });

interface AuthCtx {
  request: Request;
  env: Env;
  parts: string[]; // segments after `/api/`
  baseUrl: string;
  ctx: ExecutionContext;
}

export async function dispatchAuth(ctx: AuthCtx): Promise<Response | null> {
  const { request, env, parts, baseUrl, ctx: execCtx } = ctx;
  if (parts[0] !== 'auth') return null;
  const sub = parts.slice(1);

  // POST /api/auth/magic/request
  if (sub[0] === 'magic' && sub[1] === 'request' && request.method === 'POST') {
    const body = await safeJson(request);
    const parsed = MagicRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest('invalid email');
    const token = await generateMagicLinkToken(env.DB, parsed.data.email);
    // Magic link must point at the worker (where the callback handler lives),
    // not the site (`baseUrl`). The worker is the host receiving this request.
    const reqUrl = new URL(request.url);
    const apiOrigin = `${reqUrl.protocol}//${reqUrl.host}`;
    const magicUrl = `${apiOrigin}/api/auth/callback/magic?token=${token}`;
    if (env.RESEND_API_KEY) {
      try {
        await sendMagicLinkEmail(env.RESEND_API_KEY, parsed.data.email, magicUrl);
      } catch (err) {
        console.error('Resend send failed:', err);
        return json({ ok: false, error: 'email-send-failed' }, 502);
      }
    }
    // Always return ok to avoid leaking email-existence; in dev (no API key) return token for testing
    return json({ ok: true, devToken: env.RESEND_API_KEY ? undefined : token });
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
        location: `${baseUrl}/who`,
        'set-cookie': sessionCookie(sessionId, cookieOpts(env)),
      },
    });
  }

  // GET /api/auth/login/steam → redirect to Steam OpenID
  if (sub[0] === 'login' && sub[1] === 'steam' && request.method === 'GET') {
    const url = new URL(request.url);
    const apiOrigin = `${url.protocol}//${url.host}`;
    const loginUrl = buildSteamLoginUrl({
      realm: apiOrigin,
      returnTo: `${apiOrigin}/api/auth/callback/steam`,
    });
    return new Response(null, { status: 302, headers: { location: loginUrl } });
  }

  // GET /api/auth/link/steam → require session, redirect to Steam with intent=link
  if (sub[0] === 'link' && sub[1] === 'steam' && request.method === 'GET') {
    const linkSession = await getSessionFromRequest(env.DB, request);
    if (!linkSession) {
      return new Response(null, { status: 302, headers: { location: `${baseUrl}/signin` } });
    }
    const url = new URL(request.url);
    const apiOrigin = `${url.protocol}//${url.host}`;
    const loginUrl = buildSteamLoginUrl({
      realm: apiOrigin,
      // Steam strips arbitrary query params on the realm match but echoes
      // openid.return_to back, so the intent flag survives the round trip.
      returnTo: `${apiOrigin}/api/auth/callback/steam?intent=link`,
    });
    return new Response(null, { status: 302, headers: { location: loginUrl } });
  }

  // GET /api/auth/callback/steam — verify + (sign in OR link to current user)
  if (sub[0] === 'callback' && sub[1] === 'steam' && request.method === 'GET') {
    const callbackUrl = new URL(request.url);
    const intent = callbackUrl.searchParams.get('intent');
    const steamId = await verifySteamOpenIDResponse(callbackUrl);
    if (!steamId) return new Response('Steam verification failed', { status: 401 });

    const dbi = new Db(env.DB);
    const existing = (await env.DB.prepare(
      'SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?',
    )
      .bind('steam', steamId)
      .first()) as { user_id?: string } | null;

    if (intent === 'link') {
      const linkSession = await getSessionFromRequest(env.DB, request);
      if (!linkSession) {
        return new Response(null, { status: 302, headers: { location: `${baseUrl}/signin` } });
      }
      if (existing?.user_id && existing.user_id !== linkSession.user.id) {
        // Steam already attached to a different user — refuse to silently steal it.
        return new Response(null, {
          status: 302,
          headers: { location: `${baseUrl}/who?linkError=steam-already-linked` },
        });
      }
      if (!existing?.user_id) {
        const profile = env.STEAM_API_KEY
          ? await fetchSteamProfile(steamId, env.STEAM_API_KEY)
          : null;
        const now = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
          .bind(
            ulid(),
            linkSession.user.id,
            'steam',
            steamId,
            profile ? JSON.stringify(profile) : null,
            now,
          )
          .run();
        // Lift display_name + avatar from Steam if user hasn't set their own.
        // Heuristic: display_name still equals the email local-part means default;
        // avatar_url null means never set. Both → safe to overwrite from Steam.
        if (profile) {
          await env.DB.prepare(
            `UPDATE users
                SET display_name = CASE
                      WHEN email IS NOT NULL AND display_name = SUBSTR(email, 1, INSTR(email, '@') - 1)
                        THEN ?
                      ELSE display_name
                    END,
                    avatar_url = COALESCE(avatar_url, ?),
                    updated_at = ?
              WHERE id = ?`,
          )
            .bind(profile.personaname, profile.avatarfull, now, linkSession.user.id)
            .run();
        }
      }

      // v2.1: trigger initial Steam library sync. Block on ownership upserts
      // (cheap, ~1s), defer enrichment to ctx.waitUntil (~5-15s background).
      try {
        const { syncSteamLibrary } = await import('../lib/steam-sync.js');
        const { SteamPrivateProfileError } = await import('../lib/steam-api.js');
        try {
          await syncSteamLibrary(env, linkSession.user.id, steamId, {
            enrichmentEnabled: false,
          });
          // Background enrichment.
          execCtx.waitUntil(
            (async () => {
              try {
                await syncSteamLibrary(env, linkSession.user.id, steamId, {
                  enrichmentEnabled: true,
                });
              } catch (bgErr) {
                console.error('background enrichment after link failed:', bgErr);
              }
            })(),
          );
        } catch (err) {
          if (err instanceof SteamPrivateProfileError) {
            return new Response(null, {
              status: 302,
              headers: { location: `${baseUrl}/who?linkError=steam-private` },
            });
          }
          throw err;
        }
      } catch (outerErr) {
        console.error('initial sync after link failed:', outerErr);
        // Allow link to proceed; user can retry via /me Refresh button.
      }

      return new Response(null, {
        status: 302,
        headers: { location: `${baseUrl}/who?linked=steam` },
      });
    }

    // intent != 'link' → original sign-in / create-user flow
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
      await env.DB.prepare(
        'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(ulid(), userId, 'steam', steamId, profile ? JSON.stringify(profile) : null, now)
        .run();
    }

    const sessionId = await createSessionForUser(env.DB, userId);
    return new Response(null, {
      status: 302,
      headers: {
        location: `${baseUrl}/who`,
        'set-cookie': sessionCookie(sessionId, cookieOpts(env)),
      },
    });
  }

  // POST /api/auth/logout
  if (sub[0] === 'logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': clearSessionCookie(cookieOpts(env)),
      },
    });
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

function cookieOpts(env: Env): { domain?: string } | undefined {
  return env.SESSION_COOKIE_DOMAIN ? { domain: env.SESSION_COOKIE_DOMAIN } : undefined;
}
