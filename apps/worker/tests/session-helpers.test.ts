import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import {
  createSessionForUser,
  getSessionFromRequest,
  sessionCookie,
  clearSessionCookie,
} from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM users')]);
  const now = new Date().toISOString();
  await db().users.insert({
    id: 'u1',
    email: 'a@b.co',
    emailVerified: true,
    displayName: 'A',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  });
});

describe('createSessionForUser', () => {
  test('creates a session row and returns its ID', async () => {
    const sessionId = await createSessionForUser(env.DB, 'u1');
    expect(sessionId).toMatch(/^[A-Z0-9]{26}$/); // ULID format
    const session = await db().sessions.getById(sessionId);
    expect(session?.userId).toBe('u1');
  });
});

describe('getSessionFromRequest', () => {
  test('returns session + user for valid cookie', async () => {
    const sessionId = await createSessionForUser(env.DB, 'u1');
    const req = new Request('https://x/', { headers: { cookie: `wwp_session=${sessionId}` } });
    const result = await getSessionFromRequest(env.DB, req);
    expect(result?.user.id).toBe('u1');
    expect(result?.session.id).toBe(sessionId);
  });

  test('returns null when no cookie', async () => {
    const req = new Request('https://x/');
    expect(await getSessionFromRequest(env.DB, req)).toBeNull();
  });

  test('returns null for expired session', async () => {
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind('expired-session', 'u1', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')
      .run();
    const req = new Request('https://x/', { headers: { cookie: 'wwp_session=expired-session' } });
    expect(await getSessionFromRequest(env.DB, req)).toBeNull();
  });
});

describe('sessionCookie', () => {
  test('builds a Set-Cookie header with all required attributes', () => {
    const cookie = sessionCookie('s1');
    expect(cookie).toContain('wwp_session=s1');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=');
  });
});

describe('clearSessionCookie', () => {
  test('builds a Set-Cookie that immediately expires', () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('wwp_session=');
  });
});
