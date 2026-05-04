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
      id: 'u1', email: 'a@b.co', emailVerified: true, displayName: 'Alec',
      avatarUrl: null, createdAt: now, updatedAt: now,
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
      id: 'u1', email: 'a@b.co', emailVerified: true, displayName: 'A',
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    await db().groups.insert({
      id: 'g1', displayName: 'RIVALS', creatorId: 'u1',
      scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
      customCompletionGoals: null, createdAt: now, memberCount: 1,
    });
    const g = await db().groups.getById('g1');
    expect(g?.displayName).toBe('RIVALS');
    expect(g?.scoringWeights.preferenceMatch).toBe(0.4);
  });
});
