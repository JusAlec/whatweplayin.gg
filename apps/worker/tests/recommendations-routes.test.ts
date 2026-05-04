import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);
let alecSession: string;
let groupId: string;
const NOW = new Date().toISOString();

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
  await db().users.insert({
    id: 'u_alec',
    email: 'a@b.co',
    emailVerified: true,
    displayName: 'Alec',
    avatarUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  alecSession = await createSessionForUser(env.DB, 'u_alec');
  const create = await SELF.fetch('https://x/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `wwp_session=${alecSession}` },
    body: JSON.stringify({ displayName: 'G' }),
  });
  groupId = ((await create.json()) as { id: string }).id;
});

describe('GET /api/groups/:gid/recommendations', () => {
  test('returns picks for group with multiplayer games', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, has_coop, steam_review_pct_positive)
              VALUES ('steam-1', 'CoopGame', 1, ?, 'auto', 1, 80)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
              VALUES ('u_alec', 'steam-1', 'steam', 100, ?)`,
      ).bind(NOW),
    ]);
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      picks: Array<{ game: { id: string } }>;
      coldStart: boolean;
    };
    expect(body.picks.length).toBe(1);
    expect(body.picks[0]!.game.id).toBe('steam-1');
    expect(body.coldStart).toBe(true);
  });

  test('filters out single-player games for groups of >1', async () => {
    const otherNow = new Date().toISOString();
    await db().users.insert({
      id: 'u_other',
      email: 'o@b.co',
      emailVerified: true,
      displayName: 'O',
      avatarUrl: null,
      createdAt: otherNow,
      updatedAt: otherNow,
    });
    await env.DB.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, weight)
            VALUES (?, ?, 'member', ?, 1.0)`,
    )
      .bind(groupId, 'u_other', otherNow)
      .run();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO games (id, name, metadata_synced_at, catalog_tier, has_singleplayer, has_coop, has_pvp)
              VALUES ('steam-solo', 'SoloOnly', ?, 'auto', 1, 0, 0)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
              VALUES ('u_alec', 'steam-solo', 'steam', 100, ?)`,
      ).bind(NOW),
    ]);

    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { picks: unknown[] };
    expect(body.picks.length).toBe(0);
  });

  test('filters out games thumb-downed within veto window', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO games (id, name, metadata_synced_at, catalog_tier, has_coop)
              VALUES ('steam-veto', 'Vetoed', ?, 'auto', 1)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
              VALUES ('u_alec', 'steam-veto', 'steam', 50, ?)`,
      ).bind(NOW),
      env.DB.prepare(
        `INSERT INTO thumbs (group_id, user_id, game_id, vote, voted_at)
              VALUES (?, 'u_alec', 'steam-veto', -1, ?)`,
      ).bind(groupId, NOW),
    ]);
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { picks: unknown[] };
    expect(body.picks.length).toBe(0);
  });

  test('returns empty picks for group with no library', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { picks: unknown[] };
    expect(body.picks).toEqual([]);
  });

  test('respects WWP_RECOMMENDATIONS_LIMIT (defaults to 5)', async () => {
    for (let i = 1; i <= 8; i++) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO games (id, name, metadata_synced_at, catalog_tier, has_coop, steam_review_pct_positive)
                VALUES (?, ?, ?, 'auto', 1, ?)`,
        ).bind(`steam-${i}`, `Game ${i}`, NOW, 60 + i),
        env.DB.prepare(
          `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
                VALUES ('u_alec', ?, 'steam', 50, ?)`,
        ).bind(`steam-${i}`, NOW),
      ]);
    }
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { picks: unknown[] };
    expect(body.picks.length).toBe(5);
  });

  test('403 for non-member', async () => {
    await db().users.insert({
      id: 'u_x',
      email: 'x@b.co',
      emailVerified: true,
      displayName: 'X',
      avatarUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const xSession = await createSessionForUser(env.DB, 'u_x');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/recommendations`, {
      headers: { cookie: `wwp_session=${xSession}` },
    });
    expect(res.status).toBe(403);
  });
});
