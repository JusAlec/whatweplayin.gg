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
    id: 'u_alec',
    email: 'alec@test.co',
    emailVerified: true,
    displayName: 'Alec',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
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

describe('GET /api/groups → list user groups', () => {
  test('returns empty list for new user', async () => {
    const res = await SELF.fetch('https://x/api/groups', {
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });

  test('returns groups user is a member of', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const res = await SELF.fetch('https://x/api/groups', {
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    const body = (await res.json()) as {
      groups: Array<{ id: string; displayName: string; role: string }>;
    };
    expect(body.groups.length).toBe(1);
    expect(body.groups[0]!.id).toBe(created.id);
    expect(body.groups[0]!.role).toBe('creator');
  });
});

describe('GET /api/groups/:gid', () => {
  test('returns group + members for a member', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      group: { id: string; displayName: string };
      members: Array<{ userId: string; role: string }>;
    };
    expect(body.group.displayName).toBe('RIVALS');
    expect(body.members.length).toBe(1);
    expect(body.members[0]!.role).toBe('creator');
  });

  test('returns 403 for non-member', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_intruder',
      email: 'i@test.co',
      emailVerified: true,
      displayName: 'Intruder',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    const intruderSession = await createSessionForUser(env.DB, 'u_intruder');

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      headers: { cookie: `wwp_session=${intruderSession}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/groups/:gid', () => {
  test('creator can update display_name and weights', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'OldName' }),
    });
    const created = (await create.json()) as { id: string };

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({
        displayName: 'NewName',
        scoringWeights: { preferenceMatch: 0.5, groupFit: 0.2, sessionFit: 0.2, novelty: 0.1 },
      }),
    });
    expect(res.status).toBe(200);
    const updated = await db().groups.getById(created.id);
    expect(updated?.displayName).toBe('NewName');
    expect(updated?.scoringWeights.preferenceMatch).toBe(0.5);
  });

  test('non-creator member gets 403', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_mike',
      email: 'mike@test.co',
      emailVerified: true,
      displayName: 'Mike',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().groupMembers.insert({
      groupId: created.id,
      userId: 'u_mike',
      role: 'member',
      joinedAt: now,
      weight: 1.0,
      stablePrefs: null,
    });
    const mikeSession = await createSessionForUser(env.DB, 'u_mike');

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${mikeSession}` },
      body: JSON.stringify({ displayName: 'Hijack' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/groups/:gid', () => {
  test('creator can delete group and cascade members + invites', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'ToDelete' }),
    });
    const created = (await create.json()) as { id: string };

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(200);
    expect(await db().groups.getById(created.id)).toBeNull();
    const remainingMembers = await db().groupMembers.listByGroup(created.id);
    expect(remainingMembers.length).toBe(0);
  });

  test('non-creator gets 403', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_x',
      email: 'x@test.co',
      emailVerified: true,
      displayName: 'X',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().groupMembers.insert({
      groupId: created.id,
      userId: 'u_x',
      role: 'member',
      joinedAt: now,
      weight: 1.0,
      stablePrefs: null,
    });
    const xSession = await createSessionForUser(env.DB, 'u_x');

    const res = await SELF.fetch(`https://x/api/groups/${created.id}`, {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${xSession}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/groups/:gid/leave', () => {
  test('member can leave', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_mike',
      email: 'm@test.co',
      emailVerified: true,
      displayName: 'M',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().groupMembers.insert({
      groupId: created.id,
      userId: 'u_mike',
      role: 'member',
      joinedAt: now,
      weight: 1.0,
      stablePrefs: null,
    });
    const mikeSession = await createSessionForUser(env.DB, 'u_mike');

    const res = await SELF.fetch(`https://x/api/groups/${created.id}/leave`, {
      method: 'POST',
      headers: { cookie: `wwp_session=${mikeSession}` },
    });
    expect(res.status).toBe(200);
    const remaining = await db().groupMembers.listByGroup(created.id);
    expect(remaining.find((m) => m.userId === 'u_mike')).toBeUndefined();
  });

  test('creator cannot leave (must delete instead)', async () => {
    const create = await SELF.fetch('https://x/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
      body: JSON.stringify({ displayName: 'RIVALS' }),
    });
    const created = (await create.json()) as { id: string };

    const res = await SELF.fetch(`https://x/api/groups/${created.id}/leave`, {
      method: 'POST',
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(409);
  });
});
