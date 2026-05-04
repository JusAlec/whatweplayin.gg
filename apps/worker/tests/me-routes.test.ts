import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);

let sessionId: string;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_accounts'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const now = new Date().toISOString();
  await db().users.insert({
    id: 'u1',
    email: 'a@b.co',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: 'https://avatar.png',
    createdAt: now,
    updatedAt: now,
  });
  sessionId = await createSessionForUser(env.DB, 'u1');
});

describe('GET /api/me', () => {
  test('returns user + linked accounts', async () => {
    const res = await SELF.fetch('https://x/api/me', {
      headers: { cookie: `wwp_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      linkedAccounts: unknown[];
    };
    expect(body.user.id).toBe('u1');
    expect(body.linkedAccounts).toEqual([]);
  });

  test('returns linked Steam account when present', async () => {
    await env.DB.prepare(
      'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(
        'oa1',
        'u1',
        'steam',
        '76561198000000001',
        JSON.stringify({ personaname: 'TestUser' }),
        new Date().toISOString(),
      )
      .run();

    const res = await SELF.fetch('https://x/api/me', {
      headers: { cookie: `wwp_session=${sessionId}` },
    });
    const body = (await res.json()) as {
      linkedAccounts: Array<{ provider: string; providerUserId: string }>;
    };
    expect(body.linkedAccounts.length).toBe(1);
    expect(body.linkedAccounts[0]!.provider).toBe('steam');
  });

  test('401 unauthenticated', async () => {
    const res = await SELF.fetch('https://x/api/me');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/me/links/:provider', () => {
  test('unlinks Steam when user still has email auth available', async () => {
    await env.DB.prepare(
      'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('oa1', 'u1', 'steam', '7656', null, new Date().toISOString())
      .run();

    const res = await SELF.fetch('https://x/api/me/links/steam', {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM oauth_accounts WHERE user_id = ?',
    )
      .bind('u1')
      .first();
    expect((remaining as { n: number }).n).toBe(0);
  });

  test('refuses to unlink when it would leave user with no auth', async () => {
    // Steam-only user (no email)
    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_steam_only',
      email: null,
      emailVerified: false,
      displayName: 'SteamOnly',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await env.DB.prepare(
      'INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, provider_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind('oa_only', 'u_steam_only', 'steam', '76562', null, now)
      .run();
    const steamOnlySession = await createSessionForUser(env.DB, 'u_steam_only');

    const res = await SELF.fetch('https://x/api/me/links/steam', {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${steamOnlySession}` },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cannot-unlink-last-auth');

    // Verify the row was NOT deleted
    const row = await env.DB.prepare('SELECT id FROM oauth_accounts WHERE user_id = ?')
      .bind('u_steam_only')
      .first();
    expect(row).not.toBeNull();
  });

  test('401 unauthenticated', async () => {
    const res = await SELF.fetch('https://x/api/me/links/steam', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
