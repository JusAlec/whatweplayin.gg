import { test, expect, describe } from 'vitest';
import { buildSteamLoginUrl, verifySteamOpenIDResponse } from '../src/auth/steam-openid.js';

describe('buildSteamLoginUrl', () => {
  test('produces a valid Steam OpenID URL', () => {
    const url = buildSteamLoginUrl({
      realm: 'https://whatweplayin.gg',
      returnTo: 'https://whatweplayin.gg/api/auth/callback/steam',
    });
    expect(url).toContain('https://steamcommunity.com/openid/login');
    expect(url).toContain('openid.mode=checkid_setup');
    // Workers URLSearchParams encodes '/' as %2F but leaves ':' untouched (spec-compliant);
    // Node encodes both. Decode and parse to be runtime-agnostic.
    const params = new URL(url).searchParams;
    expect(params.get('openid.realm')).toBe('https://whatweplayin.gg');
    expect(params.get('openid.return_to')).toBe('https://whatweplayin.gg/api/auth/callback/steam');
  });
});

describe('verifySteamOpenIDResponse', () => {
  test('returns Steam ID for is_valid:true response', async () => {
    const callback = new URL(
      'https://whatweplayin.gg/api/auth/callback/steam?openid.mode=id_res&openid.claimed_id=https://steamcommunity.com/openid/id/76561198000000001&openid.identity=https://steamcommunity.com/openid/id/76561198000000001&openid.return_to=https://whatweplayin.gg/api/auth/callback/steam',
    );
    const fakeFetch = async () =>
      new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true');
    const result = await verifySteamOpenIDResponse(callback, fakeFetch as typeof fetch);
    expect(result).toBe('76561198000000001');
  });

  test('returns null for is_valid:false', async () => {
    const callback = new URL(
      'https://whatweplayin.gg/api/auth/callback/steam?openid.mode=id_res&openid.claimed_id=https://steamcommunity.com/openid/id/76561198000000001',
    );
    const fakeFetch = async () => new Response('is_valid:false');
    const result = await verifySteamOpenIDResponse(callback, fakeFetch as typeof fetch);
    expect(result).toBeNull();
  });

  test('returns null for missing openid.mode', async () => {
    const callback = new URL('https://whatweplayin.gg/api/auth/callback/steam');
    const result = await verifySteamOpenIDResponse(callback);
    expect(result).toBeNull();
  });

  test('returns null for non-Steam claimed_id', async () => {
    const callback = new URL(
      'https://whatweplayin.gg/api/auth/callback/steam?openid.mode=id_res&openid.claimed_id=https://evil.com/openid/id/76561198000000001',
    );
    const result = await verifySteamOpenIDResponse(callback);
    expect(result).toBeNull();
  });
});
