const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

export interface SteamOpenIDConfig {
  realm: string; // e.g. 'https://whatweplayin.gg'
  returnTo: string; // e.g. 'https://whatweplayin.gg/api/auth/callback/steam'
}

/** Build the Steam OpenID redirect URL — call this when user clicks "Sign in with Steam". */
export function buildSteamLoginUrl(config: SteamOpenIDConfig): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': config.returnTo,
    'openid.realm': config.realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

const STEAM_ID_REGEX = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/**
 * Verify Steam's OpenID response by re-posting the params with mode=check_authentication.
 * Returns the Steam ID 64 if valid, null if invalid.
 */
export async function verifySteamOpenIDResponse(
  callbackUrl: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const params = new URLSearchParams(callbackUrl.search);

  if (params.get('openid.mode') !== 'id_res') return null;

  const claimedId = params.get('openid.claimed_id');
  if (!claimedId) return null;

  const match = claimedId.match(STEAM_ID_REGEX);
  if (!match) return null;
  const steamId64 = match[1]!;

  // Re-post params to Steam with mode=check_authentication for signature verification
  const verifyParams = new URLSearchParams(params);
  verifyParams.set('openid.mode', 'check_authentication');

  const res = await fetchImpl(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString(),
  });
  const body = await res.text();
  // Response is plain text: "ns:http://...\nis_valid:true" or "is_valid:false"
  return body.includes('is_valid:true') ? steamId64 : null;
}

const STEAM_PROFILE_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';

export interface SteamProfileResponse {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatarfull: string;
  realname?: string;
}

export async function fetchSteamProfile(
  steamId64: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SteamProfileResponse | null> {
  const url = `${STEAM_PROFILE_URL}?key=${apiKey}&steamids=${steamId64}`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { response: { players: SteamProfileResponse[] } };
  return json.response.players[0] ?? null;
}
