import type { Env } from '../index.js';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh if <24h to expiry

interface IGDBTokenRow {
  access_token: string;
  expires_at: string;
}

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type?: string;
}

/**
 * Returns a valid IGDB access token. Reads from D1 cache if fresh; refreshes
 * via Twitch OAuth otherwise. Single-row singleton table; race on simultaneous
 * refresh is harmless (Twitch returns the same token; both writes converge).
 */
export async function getIGDBToken(env: Env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clientId = env.IGDB_CLIENT_ID;
  const clientSecret = env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not configured');
  }

  const cached = (await env.DB.prepare(
    'SELECT access_token, expires_at FROM igdb_token WHERE id = 1',
  ).first()) as IGDBTokenRow | null;

  if (cached) {
    const expiresAtMs = new Date(cached.expires_at).getTime();
    if (expiresAtMs - Date.now() > REFRESH_THRESHOLD_MS) {
      return cached.access_token;
    }
  }

  // Refresh via Twitch.
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetchImpl(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Twitch token endpoint HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as TwitchTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const refreshedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE
        SET access_token = excluded.access_token,
            expires_at = excluded.expires_at,
            refreshed_at = excluded.refreshed_at`,
  )
    .bind(data.access_token, expiresAt, refreshedAt)
    .run();
  return data.access_token;
}
