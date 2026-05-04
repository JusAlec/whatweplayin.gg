import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';

const db = () => new Db(env.DB);

beforeEach(async () => {
  // Reset all user-data tables (preserve d1_migrations)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM game_ownership'),
    env.DB.prepare('DELETE FROM games'),
    env.DB.prepare('DELETE FROM group_invites'),
    env.DB.prepare('DELETE FROM group_members'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM magic_link_tokens'),
    env.DB.prepare('DELETE FROM oauth_accounts'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
});

describe('Db.users', () => {
  test('insert + getById round-trips', async () => {
    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      displayName: 'Alec',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    const u = await db().users.getById('u1');
    expect(u?.email).toBe('a@b.co');
    expect(u?.displayName).toBe('Alec');
    expect(u?.emailVerified).toBe(true);
  });

  test('getByEmail returns null for unknown', async () => {
    const u = await db().users.getByEmail('nope@nope.co');
    expect(u).toBeNull();
  });
});

describe('Db.groups', () => {
  test('create + getById', async () => {
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
    await db().groups.insert({
      id: 'g1',
      displayName: 'RIVALS',
      creatorId: 'u1',
      scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
      customCompletionGoals: null,
      createdAt: now,
      memberCount: 1,
    });
    const g = await db().groups.getById('g1');
    expect(g?.displayName).toBe('RIVALS');
    expect(g?.scoringWeights.preferenceMatch).toBe(0.4);
  });
});

describe('Db.sessions', () => {
  test('insert + getById', async () => {
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 86_400_000).toISOString();
    await db().users.insert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().sessions.insert({ id: 's1', userId: 'u1', expiresAt: exp, createdAt: now });
    const s = await db().sessions.getById('s1');
    expect(s?.userId).toBe('u1');
  });

  test('deleteByUserId removes all user sessions', async () => {
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 86_400_000).toISOString();
    await db().users.insert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().sessions.insert({ id: 's1', userId: 'u1', expiresAt: exp, createdAt: now });
    await db().sessions.insert({ id: 's2', userId: 'u1', expiresAt: exp, createdAt: now });
    await db().sessions.deleteByUserId('u1');
    expect(await db().sessions.getById('s1')).toBeNull();
    expect(await db().sessions.getById('s2')).toBeNull();
  });
});

describe('Db.groupMembers', () => {
  test('insert + listByGroup', async () => {
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
    await db().groups.insert({
      id: 'g1',
      displayName: 'g',
      creatorId: 'u1',
      scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
      customCompletionGoals: null,
      createdAt: now,
      memberCount: 1,
    });
    await db().groupMembers.insert({
      groupId: 'g1',
      userId: 'u1',
      role: 'creator',
      joinedAt: now,
      weight: 1.0,
      stablePrefs: null,
    });
    const members = await db().groupMembers.listByGroup('g1');
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe('creator');
  });
});

describe('Db.groupInvites', () => {
  test('insert + getByCode + incrementUseCount', async () => {
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await db().users.insert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db().groups.insert({
      id: 'g1',
      displayName: 'g',
      creatorId: 'u1',
      scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
      customCompletionGoals: null,
      createdAt: now,
      memberCount: 1,
    });
    await db().groupInvites.insert({
      code: 'aBcDeF12',
      groupId: 'g1',
      createdBy: 'u1',
      expiresAt: exp,
      maxUses: 0,
      useCount: 0,
      createdAt: now,
    });
    const inv = await db().groupInvites.getByCode('aBcDeF12');
    expect(inv?.groupId).toBe('g1');
    await db().groupInvites.incrementUseCount('aBcDeF12');
    const inv2 = await db().groupInvites.getByCode('aBcDeF12');
    expect(inv2?.useCount).toBe(1);
  });
});
