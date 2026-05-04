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
    env.DB.prepare('DELETE FROM thumbs'),
    env.DB.prepare('DELETE FROM game_ownership'),
    env.DB.prepare('DELETE FROM games'),
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
  alecSession = await createSessionForUser(env.DB, 'u_alec');

  const create = await SELF.fetch('https://x/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
    body: JSON.stringify({ displayName: 'TestGroup' }),
  });
  groupId = ((await create.json()) as { id: string }).id;

  await env.DB.prepare(
    `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier)
            VALUES ('steam-100', 'TestGame', 100, ?, 'auto')`,
  )
    .bind(now)
    .run();
  await env.DB.prepare(
    `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
            VALUES ('u_alec', 'steam-100', 'steam', 50, ?)`,
  )
    .bind(now)
    .run();
});

describe('PUT /api/groups/:gid/games/:gameId/thumb', () => {
  test('upserts a thumb-up vote', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ vote: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; vote: number };
    expect(body.ok).toBe(true);
    expect(body.vote).toBe(1);
    const row = await env.DB.prepare(
      'SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
    )
      .bind(groupId, 'u_alec', 'steam-100')
      .first();
    expect((row as { vote: number }).vote).toBe(1);
  });

  test('overwrites previous vote on second PUT (upsert)', async () => {
    await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ vote: 1 }),
    });
    await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ vote: -1 }),
    });
    const row = await env.DB.prepare(
      'SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
    )
      .bind(groupId, 'u_alec', 'steam-100')
      .first();
    expect((row as { vote: number }).vote).toBe(-1);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM thumbs WHERE user_id = ? AND game_id = ?',
    )
      .bind('u_alec', 'steam-100')
      .first();
    expect((count as { n: number }).n).toBe(1);
  });

  test('400 on invalid vote value', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ vote: 0 }),
    });
    expect(res.status).toBe(400);
  });

  test('401 unauthenticated', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vote: 1 }),
    });
    expect(res.status).toBe(401);
  });

  test('403 non-member', async () => {
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
    const xSession = await createSessionForUser(env.DB, 'u_x');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${xSession}` },
      body: JSON.stringify({ vote: 1 }),
    });
    expect(res.status).toBe(403);
  });

  test('404 when game is not in any group member library', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-doesnotexist/thumb`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
      body: JSON.stringify({ vote: 1 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/groups/:gid/games/:gameId/thumb', () => {
  test('deletes existing vote', async () => {
    await env.DB.prepare(
      'INSERT INTO thumbs (group_id, user_id, game_id, vote, voted_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(groupId, 'u_alec', 'steam-100', 1, new Date().toISOString())
      .run();
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT * FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
    )
      .bind(groupId, 'u_alec', 'steam-100')
      .first();
    expect(row).toBeNull();
  });

  test('idempotent: DELETE on non-existent vote returns 200', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/games/steam-100/thumb`, {
      method: 'DELETE',
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
  });
});
