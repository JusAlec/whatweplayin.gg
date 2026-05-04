import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_accounts'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM magic_link_tokens'),
    env.DB.prepare('DELETE FROM users'),
  ]);
});

describe('POST /api/auth/magic/request', () => {
  test('creates a magic link token for a fresh email', async () => {
    const res = await SELF.fetch('https://x/api/auth/magic/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.co' }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB
      .prepare('SELECT * FROM magic_link_tokens WHERE email = ?')
      .bind('new@test.co')
      .first();
    expect(row).not.toBeNull();
  });

  test('rejects malformed email', async () => {
    const res = await SELF.fetch('https://x/api/auth/magic/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/callback/magic', () => {
  test('valid token creates user + session, sets cookie, redirects to /who', async () => {
    const token = 'a'.repeat(64);
    await env.DB
      .prepare(
        'INSERT INTO magic_link_tokens (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(
        token, 'new@test.co',
        new Date(Date.now() + 600_000).toISOString(),
        new Date().toISOString(),
      )
      .run();

    const res = await SELF.fetch(`https://x/api/auth/callback/magic?token=${token}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/who');
    expect(res.headers.get('set-cookie')).toContain('wwp_session=');

    const user = await env.DB
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind('new@test.co')
      .first();
    expect(user).not.toBeNull();
  });

  test('invalid token returns 410', async () => {
    const res = await SELF.fetch('https://x/api/auth/callback/magic?token=nope', { redirect: 'manual' });
    expect(res.status).toBe(410);
  });
});

describe('POST /api/auth/logout', () => {
  test('clears the session cookie', async () => {
    const res = await SELF.fetch('https://x/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('GET /api/auth/login/steam', () => {
  test('redirects to Steam OpenID', async () => {
    const res = await SELF.fetch('https://x/api/auth/login/steam', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://steamcommunity.com/openid/login');
  });
});

describe('POST /api/auth/magic/request with Resend', () => {
  test('returns devToken when RESEND_API_KEY is unset', async () => {
    // env in tests has no RESEND_API_KEY by default
    const res = await SELF.fetch('https://x/api/auth/magic/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@test.co' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; devToken?: string };
    expect(body.ok).toBe(true);
    expect(body.devToken).toMatch(/^[a-f0-9]{64}$/);
  });
});
