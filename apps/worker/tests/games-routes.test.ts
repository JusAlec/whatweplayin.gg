import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);

let alecSessionId: string;
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
  alecSessionId = await createSessionForUser(env.DB, 'u_alec');

  const create = await SELF.fetch('https://x/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSessionId}` },
    body: JSON.stringify({ displayName: 'TestGroup' }),
  });
  groupId = ((await create.json()) as { id: string }).id;

  await env.DB.prepare(
    `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, description, genres)
     VALUES ('steam-730', 'Counter-Strike 2', 730, ?, 'auto', 'Tactical shooter', '["Shooter"]')`,
  )
    .bind(now)
    .run();

  await env.DB.prepare(
    `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
     VALUES ('u_alec', 'steam-730', 'steam', 600, ?)`,
  )
    .bind(now)
    .run();

  await env.DB.prepare(
    `INSERT INTO thumbs (group_id, user_id, game_id, vote, voted_at)
     VALUES (?, 'u_alec', 'steam-730', 1, ?)`,
  )
    .bind(groupId, now)
    .run();
});

describe('GET /api/games/:gameId', () => {
  test('401 unauthenticated', async () => {
    const res = await SELF.fetch(`https://x/api/games/steam-730?groupId=${groupId}`);
    expect(res.status).toBe(401);
  });

  test('403 when user is not a member of the group', async () => {
    const now = new Date().toISOString();
    await db().users.insert({
      id: 'u_other',
      email: 'other@test.co',
      emailVerified: true,
      displayName: 'Other',
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    const otherSession = await createSessionForUser(env.DB, 'u_other');
    const res = await SELF.fetch(`https://x/api/games/steam-730?groupId=${groupId}`, {
      headers: { cookie: `wwp_session=${otherSession}` },
    });
    expect(res.status).toBe(403);
  });

  test('404 when game does not exist', async () => {
    const res = await SELF.fetch(`https://x/api/games/steam-999?groupId=${groupId}`, {
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(404);
  });

  test('200 with full game + groupContext for valid request', async () => {
    const res = await SELF.fetch(`https://x/api/games/steam-730?groupId=${groupId}`, {
      headers: { cookie: `wwp_session=${alecSessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      game: Record<string, unknown>;
      groupContext: {
        ownerCount: number;
        groupSize: number;
        members: Array<{
          userId: string;
          playtime: number;
        }>;
        yourVote: number;
        thumbs: { up: number; down: number };
        yourPlaytime: number | null;
      };
    };

    expect(body.game.id).toBe('steam-730');
    expect(body.game.description).toBe('Tactical shooter');
    expect(body.game.genres).toEqual(['Shooter']);

    expect(body.groupContext.ownerCount).toBe(1);
    expect(body.groupContext.groupSize).toBe(1);
    expect(body.groupContext.members.length).toBe(1);
    expect(body.groupContext.members[0]!.userId).toBe('u_alec');
    expect(body.groupContext.members[0]!.playtime).toBe(600);
    expect(body.groupContext.yourVote).toBe(1);
    expect(body.groupContext.thumbs.up).toBe(1);
    expect(body.groupContext.thumbs.down).toBe(0);
    expect(body.groupContext.yourPlaytime).toBe(600);
  });
});
