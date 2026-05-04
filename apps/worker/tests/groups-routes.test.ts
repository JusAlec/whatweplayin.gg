import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);

let alecSessionId: string;

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
  alecSessionId = await createSessionForUser(env.DB, 'u_alec');
});

describe('POST /api/groups', () => {
  test('creates a group with creator as member', async () => {
    const res = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; displayName: string };
    expect(body.displayName).toBe('RIVALS');

    const group = await db().groups.getById(body.id);
    expect(group?.creatorId).toBe('u_alec');
    expect(group?.memberCount).toBe(1);

    const members = await db().groupMembers.listByGroup(body.id);
    expect(members.length).toBe(1);
    expect(members[0]!.userId).toBe('u_alec');
    expect(members[0]!.role).toBe('creator');
  });

  test('rejects unauthenticated request with 401', async () => {
    const res = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'NopeGroup' }),
    });
    expect(res.status).toBe(401);
  });

  test('rejects empty displayName with 400', async () => {
    const res = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: '' }),
    });
    expect(res.status).toBe(400);
  });
});
