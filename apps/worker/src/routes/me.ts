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

  return null;
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
