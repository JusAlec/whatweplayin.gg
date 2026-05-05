import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { SELF, env } from 'cloudflare:test';
import { Db } from '../src/lib/d1-client.js';
import { createSessionForUser } from '../src/auth/session-helpers.js';

const db = () => new Db(env.DB);
let alecSession: string;
let groupId: string;
const NOW = new Date().toISOString();

async function seedGame(
  id: string,
  name: string,
  opts: {
    hasCoop?: boolean;
    hasPvp?: boolean;
    hasSingle?: boolean;
    reviewPct?: number | null;
  } = {},
) {
  await env.DB.prepare(
    `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier,
                        has_singleplayer, has_coop, has_pvp, steam_review_pct_positive)
          VALUES (?, ?, NULL, ?, 'auto', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      NOW,
      opts.hasSingle === false ? 0 : 1,
      opts.hasCoop ? 1 : 0,
      opts.hasPvp ? 1 : 0,
      opts.reviewPct ?? null,
    )
    .run();
}

async function seedOwnership(userId: string, gameId: string, playtime = 100) {
  await env.DB.prepare(
    `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at)
          VALUES (?, ?, 'steam', ?, ?)`,
  )
    .bind(userId, gameId, playtime, NOW)
    .run();
}

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
    email: 'alec@test.co',
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
    body: JSON.stringify({ displayName: 'TG' }),
  });
  groupId = ((await create.json()) as { id: string }).id;
});

describe('GET /api/groups/:gid/library', () => {
  test('returns all games owned by group members', async () => {
    await seedGame('steam-1', 'Alpha', { hasCoop: true });
    await seedGame('steam-2', 'Beta', { hasPvp: true });
    await seedOwnership('u_alec', 'steam-1');
    await seedOwnership('u_alec', 'steam-2');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string }; ownerCount: number }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.games.length).toBe(2);
    const ids = body.games.map((g) => g.game.id);
    expect(ids).toEqual(expect.arrayContaining(['steam-1', 'steam-2']));
  });

  test('paginates with limit + offset', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedGame(`steam-${i}`, `Game ${i}`);
      await seedOwnership('u_alec', `steam-${i}`);
    }
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?limit=2&offset=1`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as {
      games: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.games.length).toBe(2);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  test('filter=coop only returns co-op games', async () => {
    await seedGame('steam-1', 'CoopOnly', { hasCoop: true, hasSingle: false });
    await seedGame('steam-2', 'PvpOnly', { hasPvp: true, hasSingle: false });
    await seedGame('steam-3', 'SingleOnly', { hasSingle: true });
    await seedOwnership('u_alec', 'steam-1');
    await seedOwnership('u_alec', 'steam-2');
    await seedOwnership('u_alec', 'steam-3');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?filter=coop`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { games: Array<{ game: { id: string } }> };
    expect(body.games.map((g) => g.game.id)).toEqual(['steam-1']);
  });

  test('search query filters by name (case-insensitive)', async () => {
    await seedGame('steam-1', 'Counter-Strike 2');
    await seedGame('steam-2', 'Valheim');
    await seedOwnership('u_alec', 'steam-1');
    await seedOwnership('u_alec', 'steam-2');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?q=valh`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    const body = (await res.json()) as { games: Array<{ game: { name: string } }> };
    expect(body.games.length).toBe(1);
    expect(body.games[0]!.game.name).toBe('Valheim');
  });

  test('403 for non-member', async () => {
    await db().users.insert({
      id: 'u_x',
      email: 'x@test.co',
      emailVerified: true,
      displayName: 'X',
      avatarUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const xSession = await createSessionForUser(env.DB, 'u_x');
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library`, {
      headers: { cookie: `wwp_session=${xSession}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/groups/:gid/library?preset=', () => {
  beforeEach(async () => {
    // Seed u_bob and add to the group
    await db().users.insert({
      id: 'u_bob',
      email: 'bob@test.co',
      emailVerified: true,
      displayName: 'Bob',
      avatarUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await env.DB.prepare(
      'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    )
      .bind(groupId, 'u_bob', 'member', NOW)
      .run();

    // Seed 3 games with varying attributes
    // steam-1: CoopRecent — has_coop=1
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier,
                          has_singleplayer, has_coop, has_pvp, steam_review_pct_positive)
            VALUES (?, ?, NULL, ?, 'auto', ?, ?, ?, ?)`,
    )
      .bind('steam-1', 'CoopRecent', NOW, 0, 1, 0, 90)
      .run();

    // steam-2: PvpOld — has_pvp=1
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier,
                          has_singleplayer, has_coop, has_pvp, steam_review_pct_positive)
            VALUES (?, ?, NULL, ?, 'auto', ?, ?, ?, ?)`,
    )
      .bind('steam-2', 'PvpOld', NOW, 0, 0, 1, 80)
      .run();

    // steam-3: GemSingle — has_singleplayer=1, high review
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier,
                          has_singleplayer, has_coop, has_pvp, steam_review_pct_positive)
            VALUES (?, ?, NULL, ?, 'auto', ?, ?, ?, ?)`,
    )
      .bind('steam-3', 'GemSingle', NOW, 1, 0, 0, 95)
      .run();

    // Ownership rows with varying playtime/last_played
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at, last_played_at)
            VALUES (?, ?, 'steam', ?, ?, ?)`,
    )
      .bind('u_alec', 'steam-1', 5000, NOW, '2026-04-30')
      .run();
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at, last_played_at)
            VALUES (?, ?, 'steam', ?, ?, ?)`,
    )
      .bind('u_bob', 'steam-1', 3000, NOW, '2026-04-29')
      .run();
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at, last_played_at)
            VALUES (?, ?, 'steam', ?, ?, ?)`,
    )
      .bind('u_alec', 'steam-2', 100, NOW, '2025-01-01')
      .run();
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at, last_played_at)
            VALUES (?, ?, 'steam', ?, ?, ?)`,
    )
      .bind('u_alec', 'steam-3', 50, NOW, '2025-06-01')
      .run();
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, added_at, last_played_at)
            VALUES (?, ?, 'steam', ?, ?, ?)`,
    )
      .bind('u_bob', 'steam-3', 20, NOW, '2025-06-01')
      .run();
  });

  test('preset=most-owned orders by ownerCount DESC', async () => {
    const res = await SELF.fetch(
      `https://x/api/groups/${groupId}/library?preset=most-owned&limit=10`,
      { headers: { cookie: `wwp_session=${alecSession}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string }; ownerCount: number }>;
    };
    expect(body.games.length).toBeGreaterThan(0);
    // First item ownerCount >= second item ownerCount
    if (body.games.length >= 2) {
      expect(body.games[0]!.ownerCount).toBeGreaterThanOrEqual(body.games[1]!.ownerCount);
    }
    // steam-1 and steam-3 have 2 owners each; steam-2 has 1 — first items should be the 2-owner games
    const firstOwnerCount = body.games[0]!.ownerCount;
    expect(firstOwnerCount).toBe(2);
  });

  test('preset=co-op returns only coop games', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?preset=co-op&limit=10`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string; hasCoop: boolean } }>;
    };
    // All returned games must be co-op
    expect(body.games.every((g) => g.game.hasCoop === true)).toBe(true);
    // steam-1 (CoopRecent) must be included
    const ids = body.games.map((g) => g.game.id);
    expect(ids).toContain('steam-1');
    // steam-2 (PvpOld) must not appear
    expect(ids).not.toContain('steam-2');
  });

  test('preset=pvp returns only pvp games', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?preset=pvp&limit=10`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string; hasPvp: boolean } }>;
    };
    // All returned games must be pvp
    expect(body.games.every((g) => g.game.hasPvp === true)).toBe(true);
    // steam-2 (PvpOld) must appear
    const ids = body.games.map((g) => g.game.id);
    expect(ids).toContain('steam-2');
    // steam-1 (CoopRecent) must not appear
    expect(ids).not.toContain('steam-1');
  });

  test('preset=recent orders by maxLastPlayed DESC (steam-1 first)', async () => {
    const res = await SELF.fetch(`https://x/api/groups/${groupId}/library?preset=recent&limit=10`, {
      headers: { cookie: `wwp_session=${alecSession}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string } }>;
    };
    expect(body.games.length).toBeGreaterThan(0);
    // steam-1 last played 2026-04-30 is most recent
    expect(body.games[0]!.game.id).toBe('steam-1');
  });

  test('preset=hidden-gems filters low-playtime high-review games', async () => {
    const res = await SELF.fetch(
      `https://x/api/groups/${groupId}/library?preset=hidden-gems&limit=10`,
      { headers: { cookie: `wwp_session=${alecSession}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string; steamReviewPctPositive: number } }>;
    };
    const ids = body.games.map((g) => g.game.id);
    // steam-3: total playtime = 70 mins (<600), review 95% — qualifies
    expect(ids).toContain('steam-3');
    // steam-1: total playtime = 8000 mins (>>600) — excluded
    expect(ids).not.toContain('steam-1');
    // All returned games have review >= 75
    expect(body.games.every((g) => (g.game.steamReviewPctPositive ?? 0) >= 75)).toBe(true);
  });
});
