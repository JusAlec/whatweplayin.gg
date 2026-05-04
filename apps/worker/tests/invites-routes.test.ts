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

describe('POST /api/invites/accept', () => {
  test('valid code adds user to group', async () => {
    const create = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({}),
    });
    const { code } = (await create.json()) as { code: string };

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_mike', email: 'mike@test.co', emailVerified: true, displayName: 'Mike',
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const mikeSession = await createSessionForUser(env.DB, 'u_mike');

    const res = await SELF.fetch('https://x/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${mikeSession}` },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groupId: string };
    expect(body.groupId).toBe(groupId);

    const members = await db().groupMembers.listByGroup(groupId);
    expect(members.length).toBe(2);
    expect(members.find((m) => m.userId === 'u_mike')).toBeDefined();
  });

  test('expired invite returns 410', async () => {
    await env.DB
      .prepare(
        'INSERT INTO group_invites (code, group_id, created_by, expires_at, max_uses, use_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('expired1', groupId, 'u_alec', '2020-01-01T00:00:00Z', 0, 0, '2020-01-01T00:00:00Z')
      .run();

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_y', email: 'y@test.co', emailVerified: true, displayName: 'Y',
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const ySession = await createSessionForUser(env.DB, 'u_y');

    const res = await SELF.fetch('https://x/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${ySession}` },
      body: JSON.stringify({ code: 'expired1' }),
    });
    expect(res.status).toBe(410);
  });

  test('max-uses exhausted returns 410', async () => {
    await env.DB
      .prepare(
        'INSERT INTO group_invites (code, group_id, created_by, expires_at, max_uses, use_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('limited1', groupId, 'u_alec',
        new Date(Date.now() + 86_400_000).toISOString(), 1, 1, new Date().toISOString())
      .run();

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_z', email: 'z@test.co', emailVerified: true, displayName: 'Z',
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const zSession = await createSessionForUser(env.DB, 'u_z');

    const res = await SELF.fetch('https://x/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${zSession}` },
      body: JSON.stringify({ code: 'limited1' }),
    });
    expect(res.status).toBe(410);
  });

  test('already-member is idempotent (200)', async () => {
    const create = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({}),
    });
    const { code } = (await create.json()) as { code: string };

    const res = await SELF.fetch('https://x/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/invites/:code (preview)', () => {
  test('returns group preview for valid code (no auth required)', async () => {
    const create = await SELF.fetch(`https://x/api/groups/${groupId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({}),
    });
    const { code } = (await create.json()) as { code: string };

    const res = await SELF.fetch(`https://x/api/invites/${code}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groupName: string; memberCount: number; expiresAt: string };
    expect(body.groupName).toBe('RIVALS');
    expect(body.memberCount).toBe(1);
  });

  test('expired invite returns 410', async () => {
    await env.DB
      .prepare(
        'INSERT INTO group_invites (code, group_id, created_by, expires_at, max_uses, use_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('exp9', groupId, 'u_alec', '2020-01-01T00:00:00Z', 0, 0, '2020-01-01T00:00:00Z')
      .run();
    const res = await SELF.fetch('https://x/api/invites/exp9');
    expect(res.status).toBe(410);
  });
});
