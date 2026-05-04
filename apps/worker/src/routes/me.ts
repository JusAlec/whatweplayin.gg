import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
  ctx: ExecutionContext;
}

export async function dispatchMe(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts, ctx: execCtx } = ctx;
  if (parts[0] !== 'me') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  // GET /api/me
  if (parts.length === 1 && request.method === 'GET') {
    const oauthRows = await env.DB.prepare(
      'SELECT provider, provider_user_id, provider_data FROM oauth_accounts WHERE user_id = ?',
    )
      .bind(session.user.id)
      .all();
    const linkedAccounts = (oauthRows.results as Record<string, unknown>[]).map((r) => ({
      provider: r.provider as string,
      providerUserId: r.provider_user_id as string,
      providerData: r.provider_data ? JSON.parse(r.provider_data as string) : null,
    }));

    // v2.1: autosync if enabled + Steam linked + library is stale.
    if (env.WWP_FEAT_AUTOSYNC_ON_LOGIN === 'true') {
      const oauthRow = (await env.DB.prepare(
        'SELECT provider_user_id FROM oauth_accounts WHERE user_id = ? AND provider = ?',
      )
        .bind(session.user.id, 'steam')
        .first()) as { provider_user_id?: string } | null;

      if (oauthRow?.provider_user_id) {
        const { readNumber } = await import('../lib/flags.js');
        const stalenessHours = readNumber(env, 'WWP_AUTOSYNC_STALENESS_HOURS', 6);
        const stalenessMs = stalenessHours * 60 * 60 * 1000;
        const syncedAt = session.user.steamLibrarySyncedAt;
        const isStale = !syncedAt || Date.now() - new Date(syncedAt).getTime() > stalenessMs;
        if (isStale) {
          execCtx.waitUntil(
            (async () => {
              const { syncSteamLibrary } = await import('../lib/steam-sync.js');
              const { SteamPrivateProfileError } = await import('../lib/steam-api.js');
              try {
                await syncSteamLibrary(env, session.user.id, oauthRow.provider_user_id!);
              } catch (err) {
                if (err instanceof SteamPrivateProfileError) {
                  // synced_at already bumped to prevent re-fire.
                  return;
                }
                console.error('autosync failed:', err);
              }
            })(),
          );
        }
      }
    }

    return jsonStatus({ user: session.user, linkedAccounts }, 200);
  }

  // DELETE /api/me/links/:provider — unlink an OAuth identity from the current user
  if (
    parts.length === 3 &&
    parts[1] === 'links' &&
    parts[2] !== undefined &&
    request.method === 'DELETE'
  ) {
    const provider = parts[2];
    // Guard: refuse if removing this would leave the user with no way back in.
    // A user is locked out when they have no email AND only one (or zero) linked
    // OAuth identities. Since they're signed in via session, at least one auth
    // method must remain after the unlink.
    const linkedCountRow = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?',
    )
      .bind(session.user.id)
      .first()) as { n?: number } | null;
    const linkedCount = linkedCountRow?.n ?? 0;
    const hasEmail = session.user.email != null && session.user.email !== '';
    const otherAuthRemains = hasEmail || linkedCount > 1;
    if (!otherAuthRemains) {
      return jsonStatus(
        {
          error: 'cannot-unlink-last-auth',
          message: `Set an email on your account before unlinking ${provider} — otherwise you'd lose all access.`,
        },
        409,
      );
    }

    const result = await env.DB.prepare(
      'DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?',
    )
      .bind(session.user.id, provider)
      .run();
    if (!result.success) return jsonStatus({ error: 'delete-failed' }, 500);

    return jsonStatus({ ok: true, provider }, 200);
  }

  // POST /api/me/sync/steam — manual library refresh (blocking, full pipeline)
  if (
    parts.length === 3 &&
    parts[1] === 'sync' &&
    parts[2] === 'steam' &&
    request.method === 'POST'
  ) {
    const oauthRow = (await env.DB.prepare(
      'SELECT provider_user_id FROM oauth_accounts WHERE user_id = ? AND provider = ?',
    )
      .bind(session.user.id, 'steam')
      .first()) as { provider_user_id?: string } | null;
    if (!oauthRow?.provider_user_id) {
      return jsonStatus({ error: 'no-steam-linked' }, 400);
    }

    try {
      const { syncSteamLibrary } = await import('../lib/steam-sync.js');
      const result = await syncSteamLibrary(env, session.user.id, oauthRow.provider_user_id);
      return jsonStatus({ ok: true, ...result }, 200);
    } catch (err) {
      const { SteamPrivateProfileError } = await import('../lib/steam-api.js');
      if (err instanceof SteamPrivateProfileError) {
        return jsonStatus(
          { error: 'steam-private', helpUrl: 'https://steamcommunity.com/my/edit/settings' },
          422,
        );
      }
      console.error('manual sync failed:', err);
      return jsonStatus({ error: 'sync-failed', message: String(err) }, 502);
    }
  }

  // POST /api/me/enrich-more — continue enrichment for current user without
  // re-fetching the library. Used by the frontend auto-loop after initial sync
  // to chip away at un-enriched games batch by batch (~20 per call) within
  // the Cloudflare Workers free-tier 50-subrequest cap.
  if (parts.length === 2 && parts[1] === 'enrich-more' && request.method === 'POST') {
    try {
      const { enrichUserGames } = await import('../lib/steam-sync.js');
      const result = await enrichUserGames(env, session.user.id);
      return jsonStatus({ ok: true, ...result }, 200);
    } catch (err) {
      console.error('enrich-more failed:', err);
      return jsonStatus({ error: 'enrich-failed', message: String(err) }, 502);
    }
  }

  return null;
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
