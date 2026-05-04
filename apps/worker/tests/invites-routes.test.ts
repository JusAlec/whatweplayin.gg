import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);

let alecSession: string;
let groupId: string;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM group_invites'),
    env.DB.prepare('DELETE FROM group_members'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
  const now = new Date().toISOString();
  await db().users.insert({
    id: 'u_alec', email: 'alec@test.co', emailVerified: true, displayName: 'Alec',
    avatarUrl: null, createdAt: now, updatedAt: now,
  });
  alecSession = await createSessionForUser(env.DB, 'u_alec');

  const create = await SELF.fetch('https://x/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
    body: JSON.stringify({ displayName: 'RIVALS' }),
  });
  groupId = ((await create.json()) as { id: string }).id;
});

describe('POST /api/groups/:gid/invites', () => {
  test('creates invite with default 7-day expiry', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(body.code).toMatch(/^[a-zA-Z0-9]{8}$/);
    const exp = new Date(body.expiresAt).getTime();
    const expected = Date.now() + 7 * 86_400_000;
    expect(Math.abs(exp - expected)).toBeLessThan(60_000);
  });

  test('rejects non-member with 403', async () => {
    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_x', email: 'x@test.co', emailVerified: true, displayName: 'X',
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const xSession = await createSessionForUser(env.DB, 'u_x');

    const res = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${xSession}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/groups/:gid/invites', () => {
  test('lists active invites for the group', async () => {
    await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({}),
    });
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { invites: Array<{ code: string }> };
    expect(body.invites.length).toBe(1);
  });
});
