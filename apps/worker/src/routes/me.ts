import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchMe(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
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

  return null;
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
