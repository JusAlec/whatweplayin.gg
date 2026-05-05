# WhatWePlayin v2.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Netflix-style UI for the group page (full-bleed hero + 6 themed rows + game-detail modal + search overlay + group-settings page), backed by IGDB metadata enrichment for descriptions, genres, hero artwork, and player counts. Recommender gains a fourth `groupFit` factor using the new IGDB data.

**Architecture:** Layered enrichment — Steam Store API stays primary for `has_coop`/`has_pvp`/`cover_url`/reviews; IGDB layers on `description`, `genres`, `igdb_screenshot_id`, `optimal_min`/`optimal_max`. Single HTTP call per game via APICalypse relation filtering through Steam app ID. UI rewrite uses 6 themed rows backed by a `?preset=` query param on the existing library route, plus a new `GET /api/games/:gameId` for the modal. groupFit recommender factor weighted at 0.2 with weights rebalanced to 0.4/0.2/0.2/0.2.

**Tech Stack:** Cloudflare Workers (TypeScript), D1 (SQLite), Astro 4 SSR via `@astrojs/cloudflare`, React 18 islands, Tailwind, Vitest + miniflare for worker tests, `@cloudflare/vitest-pool-workers`, IGDB API + Twitch OAuth client credentials.

**Working Directory:** `C:/QR8/gamenight-os`. Run pnpm via `npx pnpm@9.15.4 ...`. Run worker tests with `BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test`. Build site with `npx pnpm@9.15.4 --filter @wwp/site build`.

**Spec:** `docs/superpowers/specs/2026-05-04-whatweplayin-v2-2-design.md`.

**Pre-flight (one-time, user action):** GitHub Secrets `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` must already be populated with Twitch dev app credentials. Implementation will wire these into the deploy-worker job in Batch 9.

---

## Batch 1 — Foundation (schema, types, env vars)

### Task 1: D1 migration 0006

**Files:**

- Create: `apps/worker/migrations/0006_v22_igdb_metadata.sql`

- [ ] **Step 1: Write the migration**

`apps/worker/migrations/0006_v22_igdb_metadata.sql`:

```sql
-- v2.2: IGDB metadata layered on top of Steam Store + Twitch OAuth token cache

ALTER TABLE games ADD COLUMN description TEXT;
ALTER TABLE games ADD COLUMN genres TEXT NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN igdb_screenshot_id TEXT;

CREATE TABLE igdb_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
```

- [ ] **Step 2: Run worker tests to confirm migration applies cleanly**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test 2>&1 | tail -5
```

Expected: existing ~133 worker tests still pass. Vitest auto-discovers all `migrations/*.sql` files and applies them per-test.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/migrations/0006_v22_igdb_metadata.sql
git commit -m "feat(d1): migration 0006 — IGDB description/genres/screenshot + igdb_token"
```

---

### Task 2: Extend `@wwp/auth-shared` types

**Files:**

- Modify: `packages/auth-shared/src/types.ts`

- [ ] **Step 1: Append v2.2 types at the end of the file**

```ts
// === v2.2 additions ===

/** Game shape extended with v2.2 IGDB metadata. NULL fields mean IGDB hasn't enriched this game yet. */
export interface GameV22 extends GameV21 {
  description: string | null;
  genres: string[]; // parsed from JSON column
  igdbScreenshotId: string | null;
  optimalMin: number | null;
  optimalMax: number | null;
}

/** Per-member ownership context for the game-detail modal. */
export interface MemberOwnership {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  playtime: number; // minutes
  lastPlayed: string | null; // ISO timestamp
}

/** Response shape for GET /api/games/:gameId?groupId=:gid */
export interface GameDetailResponse {
  game: GameV22;
  groupContext: {
    ownerCount: number;
    groupSize: number;
    members: MemberOwnership[];
    yourVote: -1 | 0 | 1;
    thumbs: { up: number; down: number };
    yourPlaytime: number | null;
    yourLastPlayed: string | null;
  };
}

/** Library preset names (themed rows). */
export type LibraryPreset = 'most-owned' | 'co-op' | 'pvp' | 'recent' | 'hidden-gems';
```

- [ ] **Step 2: Verify types compile**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/auth-shared typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Workspace-wide typecheck**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 -r typecheck 2>&1 | tail -10
```

Expected: all packages compile clean.

- [ ] **Step 4: Commit**

```bash
git add packages/auth-shared/src/types.ts
git commit -m "feat(auth-shared): v2.2 types — GameV22, MemberOwnership, GameDetailResponse, LibraryPreset"
```

---

### Task 3: Worker Env interface + wrangler.toml feature flags

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/wrangler.toml`

- [ ] **Step 1: Extend the Env interface in `apps/worker/src/index.ts`**

Find the `export interface Env { ... }` block. Append after the existing v2.1 fields:

```ts
  // v2.2 IGDB credentials (already declared optional in v2.0; promoted to required in v2.2 path
  // gated by WWP_FEAT_IGDB — if flag off, code never reads them)
  IGDB_CLIENT_ID?: string;
  IGDB_CLIENT_SECRET?: string;

  // v2.2 toggles + tunables
  WWP_FEAT_IGDB?: string;
  WWP_WEIGHT_GROUPFIT?: string;
  WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD?: string;
```

NOTE: `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` were declared in v2.0's Env interface but never used. Verify they're already there; if so, leave them alone. If absent, add as shown.

- [ ] **Step 2: Update `apps/worker/wrangler.toml [vars]`**

Find the `[vars]` block. Update existing weights to v2.2 rebalanced values + add new flags:

```toml
# v2.1 flags (unchanged)
WWP_FEAT_AUTOSYNC_ON_LOGIN = "true"
WWP_FEAT_THUMBS = "true"
WWP_FEAT_RECOMMENDATIONS = "true"
WWP_FEAT_STEAM_RATINGS = "true"

# v2.1 tunables — v2.2 rebalances weights (was 0.5/0.3/0.2)
WWP_AUTOSYNC_STALENESS_HOURS = "6"
WWP_WEIGHT_THUMBS = "0.4"
WWP_WEIGHT_OWNERSHIP = "0.2"
WWP_WEIGHT_NOVELTY = "0.2"
WWP_WEIGHT_GROUPFIT = "0.2"
WWP_RECOMMENDATIONS_LIMIT = "5"
WWP_THUMBS_DOWN_VETO_DAYS = "7"
WWP_ENRICHMENT_MAX_PER_RUN = "13"

# v2.2 new
WWP_FEAT_IGDB = "true"
WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD = "600"
```

- [ ] **Step 3: Run worker typecheck**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/worker typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4: Run worker tests**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test 2>&1 | tail -5
```

Expected: all ~133 tests pass. Some recommender behavior may shift if any test seeded the old default weights via env, but tests don't set env weights — they pass `weights` directly into `rankByThumbs`. So unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/wrangler.toml
git commit -m "feat(worker): v2.2 env vars — IGDB flag, groupFit weight, rebalanced weights, MAX_PER_RUN=13"
```

---

### Task 4: Update `docs/feature-flags.md`

**Files:**

- Modify: `docs/feature-flags.md`

- [ ] **Step 1: Read the current file**

```bash
cd /c/QR8/gamenight-os && cat docs/feature-flags.md
```

You'll see a "v2.1 flags" table.

- [ ] **Step 2: Update existing rows + append v2.2 rows**

Find the row for `WWP_WEIGHT_THUMBS`. Change its default cell from `"0.5"` to `"0.4"`. Same for:

- `WWP_WEIGHT_OWNERSHIP`: `"0.3"` → `"0.2"`
- `WWP_ENRICHMENT_MAX_PER_RUN`: `"20"` → `"13"`

Then append new rows below the v2.1 section:

```markdown
## v2.2 flags

| Flag                                 | Type   | Default  | Helper       | When ON / set                                                                                                                     | When OFF / unset                         | Notes                                                |
| ------------------------------------ | ------ | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `WWP_FEAT_IGDB`                      | bool   | `"true"` | `flagOn`     | enrichOne calls IGDB games endpoint after Steam Store; populates description/genres/igdb_screenshot_id/optimal_min/max            | IGDB step skipped; sync stays Steam-only | Flip to `"false"` if IGDB has an outage              |
| `WWP_WEIGHT_GROUPFIT`                | number | `"0.2"`  | `readNumber` | recommender weight on the groupFit axis (player-count-fit)                                                                        | (n/a)                                    | Defaults sum to 1.0 with rebalanced thumbs/ownership |
| `WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD` | number | `"600"`  | `readNumber` | playtime ceiling (minutes) for the hidden-gems library preset; games with total group playtime ≤ this AND review pct ≥ 75 qualify | (n/a)                                    | Increase if hidden-gems row is sparse                |
```

- [ ] **Step 3: Commit**

```bash
git add docs/feature-flags.md
git commit -m "docs(flags): v2.2 — IGDB, groupFit, hidden-gems threshold + rebalanced weights"
```

---

## Batch 2 — IGDB API helpers

### Task 5: Twitch OAuth token caching

**Files:**

- Create: `apps/worker/src/lib/igdb-api.ts`
- Create: `apps/worker/tests/igdb-api.test.ts`

- [ ] **Step 1: Write the test first**

`apps/worker/tests/igdb-api.test.ts`:

```ts
import { test, expect, describe, beforeEach, vi } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { getIGDBToken } from '../src/lib/igdb-api.js';

beforeEach(async () => {
  env.IGDB_CLIENT_ID = 'test-client-id';
  env.IGDB_CLIENT_SECRET = 'test-client-secret';
  await env.DB.prepare('DELETE FROM igdb_token').run();
});

describe('getIGDBToken', () => {
  test('fetches a fresh token when cache is empty', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'tok-fresh', expires_in: 5184000, token_type: 'bearer' }),
          { status: 200 },
        ),
    );
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-fresh');
    const row = await env.DB.prepare('SELECT access_token FROM igdb_token WHERE id = 1').first();
    expect((row as { access_token: string }).access_token).toBe('tok-fresh');
  });

  test('returns cached token when far from expiry', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
    )
      .bind('tok-cached', future, new Date().toISOString())
      .run();
    const fakeFetch = vi.fn();
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-cached');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  test('refreshes when within 24h of expiry', async () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
    )
      .bind('tok-stale', soon, new Date().toISOString())
      .run();
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok-refreshed', expires_in: 5184000 }), {
          status: 200,
        }),
    );
    const token = await getIGDBToken(env, fakeFetch as typeof fetch);
    expect(token).toBe('tok-refreshed');
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  test('throws when Twitch token endpoint fails', async () => {
    const fakeFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(getIGDBToken(env, fakeFetch as typeof fetch)).rejects.toThrow();
  });

  test('throws when client credentials are missing', async () => {
    env.IGDB_CLIENT_ID = '';
    env.IGDB_CLIENT_SECRET = '';
    const fakeFetch = vi.fn();
    await expect(getIGDBToken(env, fakeFetch as typeof fetch)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/igdb-api.test.ts 2>&1 | tail -10
```

Expected: import errors (file doesn't exist).

- [ ] **Step 3: Implement `apps/worker/src/lib/igdb-api.ts`**

```ts
import type { Env } from '../index.js';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh if <24h to expiry

interface IGDBTokenRow {
  access_token: string;
  expires_at: string;
}

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type?: string;
}

/**
 * Returns a valid IGDB access token. Reads from D1 cache if fresh; refreshes
 * via Twitch OAuth otherwise. Single-row singleton table; race on simultaneous
 * refresh is harmless (Twitch returns the same token; both writes converge).
 */
export async function getIGDBToken(env: Env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clientId = env.IGDB_CLIENT_ID;
  const clientSecret = env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not configured');
  }

  const cached = (await env.DB.prepare(
    'SELECT access_token, expires_at FROM igdb_token WHERE id = 1',
  ).first()) as IGDBTokenRow | null;

  if (cached) {
    const expiresAtMs = new Date(cached.expires_at).getTime();
    if (expiresAtMs - Date.now() > REFRESH_THRESHOLD_MS) {
      return cached.access_token;
    }
  }

  // Refresh via Twitch.
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetchImpl(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Twitch token endpoint HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as TwitchTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const refreshedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE
        SET access_token = excluded.access_token,
            expires_at = excluded.expires_at,
            refreshed_at = excluded.refreshed_at`,
  )
    .bind(data.access_token, expiresAt, refreshedAt)
    .run();
  return data.access_token;
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/igdb-api.test.ts 2>&1 | tail -8
```

Expected: 5 tests pass.

- [ ] **Step 5: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/lib/igdb-api.ts apps/worker/tests/igdb-api.test.ts 2>&1 | tail -3
git add apps/worker/src/lib/igdb-api.ts apps/worker/tests/igdb-api.test.ts
git commit -m "feat(worker): IGDB Twitch OAuth token caching with D1 singleton + 24h refresh window"
```

---

### Task 6: IGDB game lookup by Steam app ID

**Files:**

- Modify: `apps/worker/src/lib/igdb-api.ts`
- Modify: `apps/worker/tests/igdb-api.test.ts`

- [ ] **Step 1: Append tests**

```ts
import { fetchIGDBGameByAppId, type IGDBGame } from '../src/lib/igdb-api.js';

async function seedToken() {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
  )
    .bind('tok-test', future, new Date().toISOString())
    .run();
}

describe('fetchIGDBGameByAppId', () => {
  beforeEach(seedToken);

  test('returns parsed game data on success', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              name: 'Counter-Strike 2',
              summary: 'Free-to-play tactical shooter.',
              genres: [{ name: 'Shooter' }, { name: 'Strategy' }],
              multiplayer_modes: [{ online_max: 10, online_coop_max: 0, lan_max: 10 }],
              cover: { image_id: 'co1abc' },
              screenshots: [{ image_id: 'sc1xyz' }],
            },
          ]),
          { status: 200 },
        ),
    );
    const game = await fetchIGDBGameByAppId(env, 730, fakeFetch as typeof fetch);
    expect(game).not.toBeNull();
    expect(game!.name).toBe('Counter-Strike 2');
    expect(game!.summary).toContain('shooter');
    expect(game!.genres).toEqual([{ name: 'Shooter' }, { name: 'Strategy' }]);
    expect(game!.multiplayer_modes![0]!.online_max).toBe(10);
    expect(game!.cover!.image_id).toBe('co1abc');
    expect(game!.screenshots![0]!.image_id).toBe('sc1xyz');
  });

  test('returns null when game is not in IGDB', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const game = await fetchIGDBGameByAppId(env, 99999, fakeFetch as typeof fetch);
    expect(game).toBeNull();
  });

  test('returns null on HTTP error (not throwing — caller decides)', async () => {
    const fakeFetch = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const game = await fetchIGDBGameByAppId(env, 730, fakeFetch as typeof fetch);
    expect(game).toBeNull();
  });

  test('builds APICalypse query with external_games filter', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    await fetchIGDBGameByAppId(env, 730, fakeFetch as typeof fetch);
    const [, init] = fakeFetch.mock.calls[0]!;
    const body = (init as RequestInit).body as string;
    expect(body).toContain('external_games.category = 1');
    expect(body).toContain('external_games.uid = "730"');
    expect(body).toContain('limit 1');
    expect(body).toContain('genres.name');
    expect(body).toContain('multiplayer_modes');
  });
});
```

Note: the tests rely on `getIGDBToken` working from Task 5; that's why we seed `igdb_token` in `beforeEach`.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/igdb-api.test.ts 2>&1 | tail -10
```

Expected: import errors for `fetchIGDBGameByAppId` and `IGDBGame`.

- [ ] **Step 3: Append helper to `apps/worker/src/lib/igdb-api.ts`**

```ts
const IGDB_GAMES_URL = 'https://api.igdb.com/v4/games';

export interface IGDBGame {
  name: string;
  summary?: string;
  genres?: Array<{ name: string }>;
  multiplayer_modes?: Array<{
    online_max?: number;
    online_coop_max?: number;
    lan_max?: number;
  }>;
  cover?: { image_id: string };
  screenshots?: Array<{ image_id: string }>;
}

/**
 * Fetch an IGDB game by Steam app ID. Returns null on not-found or HTTP error
 * (caller treats as "no IGDB data"; row stays un-IGDB-enriched and retries
 * next sync round).
 */
export async function fetchIGDBGameByAppId(
  env: Env,
  steamAppId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<IGDBGame | null> {
  const clientId = env.IGDB_CLIENT_ID;
  if (!clientId) return null;

  let token: string;
  try {
    token = await getIGDBToken(env, fetchImpl);
  } catch (err) {
    console.error('IGDB token fetch failed:', err);
    return null;
  }

  const body = `fields name, summary, genres.name, multiplayer_modes.online_max, multiplayer_modes.online_coop_max, multiplayer_modes.lan_max, cover.image_id, screenshots.image_id;
where external_games.category = 1 & external_games.uid = "${steamAppId}";
limit 1;`;

  const res = await fetchImpl(IGDB_GAMES_URL, {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) return null;

  const data = (await res.json()) as IGDBGame[];
  return data[0] ?? null;
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/igdb-api.test.ts 2>&1 | tail -8
```

Expected: 5 + 4 = 9 tests pass.

- [ ] **Step 5: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/lib/igdb-api.ts apps/worker/tests/igdb-api.test.ts 2>&1 | tail -3
git add apps/worker/src/lib/igdb-api.ts apps/worker/tests/igdb-api.test.ts
git commit -m "feat(worker): IGDB games lookup by Steam app ID via APICalypse relation filter"
```

---

## Batch 3 — Steam-sync IGDB integration

### Task 7: enrichOne pulls IGDB data alongside Steam

**Files:**

- Modify: `apps/worker/src/lib/steam-sync.ts`
- Modify: `apps/worker/tests/steam-sync.test.ts`

- [ ] **Step 1: Read the current `steam-sync.ts` enrichOne function**

```bash
cat apps/worker/src/lib/steam-sync.ts | sed -n '/^async function enrichOne/,/^}/p'
```

Confirm the current shape — it calls `fetchAppDetails` then `fetchAppReviews` then a single UPDATE.

- [ ] **Step 2: Append a test for IGDB integration**

In `apps/worker/tests/steam-sync.test.ts`, append at the end:

```ts
describe('syncSteamLibrary — IGDB enrichment integration', () => {
  beforeEach(async () => {
    env.IGDB_CLIENT_ID = 'tc';
    env.IGDB_CLIENT_SECRET = 'ts';
    env.WWP_FEAT_IGDB = 'true';
    // seed a fresh IGDB token so getIGDBToken doesn't try to call Twitch.
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      'INSERT OR REPLACE INTO igdb_token (id, access_token, expires_at, refreshed_at) VALUES (1, ?, ?, ?)',
    )
      .bind('tok', future, new Date().toISOString())
      .run();
  });

  test('populates description, genres, igdb_screenshot_id, optimal_min/max from IGDB', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 730, name: 'CS2', playtime_forever: 0, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: {
                type: 'game',
                name: 'CS2',
                header_image: 'https://h/730.jpg',
                categories: [
                  { id: 1, description: 'Multi-player' },
                  { id: 49, description: 'PvP' },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response(
          JSON.stringify({
            success: 1,
            query_summary: {
              review_score: 9,
              review_score_desc: 'OP',
              total_positive: 95,
              total_reviews: 100,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('api.igdb.com')) {
        return new Response(
          JSON.stringify([
            {
              name: 'Counter-Strike 2',
              summary: 'Tactical shooter.',
              genres: [{ name: 'Shooter' }],
              multiplayer_modes: [{ online_max: 10 }],
              cover: { image_id: 'co1abc' },
              screenshots: [{ image_id: 'sc1xyz' }],
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
      enrichmentParallelism: 1,
    });

    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind('steam-730').first();
    expect((game as any).description).toBe('Tactical shooter.');
    expect(JSON.parse((game as any).genres)).toEqual(['Shooter']);
    expect((game as any).igdb_screenshot_id).toBe('sc1xyz');
    expect((game as any).optimal_min).toBe(1); // hasSinglePlayer is false (no 'Single-player' category) but no multiplayer-only flag — see helper
    expect((game as any).optimal_max).toBe(10);
  });

  test('skips IGDB when WWP_FEAT_IGDB is "false"', async () => {
    env.WWP_FEAT_IGDB = 'false';
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 730, name: 'CS2', playtime_forever: 0, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '730': {
              success: true,
              data: { type: 'game', name: 'CS2', header_image: '', categories: [] },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response(
          JSON.stringify({
            success: 1,
            query_summary: { review_score: 0, total_positive: 0, total_reviews: 0 },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });
    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
    });
    const igdbCalls = fakeFetch.mock.calls.filter((c) => (c[0] as string).includes('api.igdb.com'));
    expect(igdbCalls.length).toBe(0);
    const game = await env.DB.prepare('SELECT description FROM games WHERE id = ?')
      .bind('steam-730')
      .first();
    expect((game as any).description).toBeNull();
  });

  test('graceful when IGDB returns nothing for the game (Steam fields still populate)', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('GetOwnedGames')) {
        return new Response(
          JSON.stringify({
            response: {
              game_count: 1,
              games: [{ appid: 99999, name: 'Obscure', playtime_forever: 0, rtime_last_played: 0 }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appdetails')) {
        return new Response(
          JSON.stringify({
            '99999': {
              success: true,
              data: {
                type: 'game',
                name: 'Obscure',
                header_image: 'h.jpg',
                categories: [{ id: 2, description: 'Single-player' }],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('appreviews')) {
        return new Response('error', { status: 500 });
      }
      if (url.includes('api.igdb.com')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    await syncSteamLibrary(env, 'u1', '76561198000000001', {
      fetchImpl: fakeFetch as typeof fetch,
      enrichmentEnabled: true,
    });
    const game = await env.DB.prepare('SELECT * FROM games WHERE id = ?')
      .bind('steam-99999')
      .first();
    expect((game as any).name).toBe('Obscure');
    expect((game as any).has_singleplayer).toBe(1);
    expect((game as any).description).toBeNull();
    expect((game as any).igdb_screenshot_id).toBeNull();
    expect((game as any).metadata_synced_at).not.toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/steam-sync.test.ts 2>&1 | tail -10
```

Expected: 3 new tests fail (description/genres/etc. stay NULL because IGDB step doesn't exist yet).

- [ ] **Step 4: Modify `enrichOne` in `apps/worker/src/lib/steam-sync.ts` to call IGDB**

Find the existing `enrichOne` function. Replace it entirely with this version:

```ts
async function enrichOne(
  env: Env,
  gameId: string,
  appid: number,
  fetchImpl: typeof fetch,
): Promise<void> {
  const details = await fetchAppDetails(appid, fetchImpl);
  if (!details) {
    markAppidSkipped(appid);
    return;
  }

  let reviews = null;
  try {
    reviews = await fetchAppReviews(appid, fetchImpl);
  } catch {
    reviews = null;
  }

  // v2.2: layer IGDB on top, gated by WWP_FEAT_IGDB.
  let igdbDescription: string | null = null;
  let igdbGenres: string[] = [];
  let igdbScreenshotId: string | null = null;
  let optimalMin: number | null = null;
  let optimalMax: number | null = null;

  if (env.WWP_FEAT_IGDB === 'true') {
    try {
      const { fetchIGDBGameByAppId } = await import('./igdb-api.js');
      const igdb = await fetchIGDBGameByAppId(env, appid, fetchImpl);
      if (igdb) {
        igdbDescription = igdb.summary ?? null;
        igdbGenres = (igdb.genres ?? []).map((g) => g.name);
        // Prefer the first screenshot; fall back to cover for the hero backdrop.
        igdbScreenshotId = igdb.screenshots?.[0]?.image_id ?? igdb.cover?.image_id ?? null;
        const optimal = deriveOptimalPlayerCount(
          igdb.multiplayer_modes ?? [],
          details.hasSinglePlayer,
        );
        optimalMin = optimal.min;
        optimalMax = optimal.max;
      }
    } catch (err) {
      console.error('IGDB enrichment failed for', appid, err);
    }
  }

  const now = new Date().toISOString();
  const minPlayers = 1;
  const maxPlayers = details.hasCoop || details.hasPvp ? 8 : 1;

  await env.DB.prepare(
    `UPDATE games
        SET name = ?,
            cover_url = ?,
            has_singleplayer = ?,
            has_coop = ?,
            has_pvp = ?,
            min_players = ?,
            max_players = ?,
            optimal_min = ?,
            optimal_max = ?,
            release_date = ?,
            metadata_synced_at = ?,
            steam_review_score = ?,
            steam_review_score_desc = ?,
            steam_review_pct_positive = ?,
            steam_review_count = ?,
            description = ?,
            genres = ?,
            igdb_screenshot_id = ?
      WHERE id = ?`,
  )
    .bind(
      details.name,
      details.headerImage,
      details.hasSinglePlayer ? 1 : 0,
      details.hasCoop ? 1 : 0,
      details.hasPvp ? 1 : 0,
      minPlayers,
      maxPlayers,
      optimalMin,
      optimalMax,
      details.releaseDate,
      now,
      reviews?.score ?? null,
      reviews?.scoreDesc ?? null,
      reviews?.pctPositive ?? null,
      reviews?.count ?? null,
      igdbDescription,
      JSON.stringify(igdbGenres),
      igdbScreenshotId,
      gameId,
    )
    .run();
}

function deriveOptimalPlayerCount(
  modes: Array<{ online_max?: number; online_coop_max?: number; lan_max?: number }>,
  hasSinglePlayer: boolean,
): { min: number | null; max: number | null } {
  if (!modes || modes.length === 0) {
    return { min: null, max: null };
  }
  let max = 0;
  for (const mode of modes) {
    max = Math.max(max, mode.online_max ?? 0, mode.online_coop_max ?? 0, mode.lan_max ?? 0);
  }
  if (max === 0) return { min: null, max: null };
  const min = hasSinglePlayer ? 1 : Math.max(2, max);
  return { min: hasSinglePlayer ? 1 : 2, max };
}
```

NOTE on the `min` derivation: when `hasSinglePlayer` is false and IGDB has multiplayer data, set min = 2 (not 1). When `hasSinglePlayer` is true, min = 1 (game can be played alone). The line `const min = hasSinglePlayer ? 1 : Math.max(2, max);` is wrong — corrected on the next line. The simpler form is `const min = hasSinglePlayer ? 1 : 2;`. Use that.

- [ ] **Step 5: Drop default parallelism from 6 to 3**

In the same file, find `enrichmentParallelism` default. Update:

```ts
const parallelism = opts.enrichmentParallelism ?? 3; // was 6 in v2.1; dropped for IGDB rate limit (4/sec)
```

- [ ] **Step 6: Run worker tests**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/steam-sync.test.ts 2>&1 | tail -8
```

Expected: existing 11 sync tests + 3 new IGDB tests = 14 pass.

- [ ] **Step 7: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/lib/steam-sync.ts apps/worker/tests/steam-sync.test.ts 2>&1 | tail -3
git add apps/worker/src/lib/steam-sync.ts apps/worker/tests/steam-sync.test.ts
git commit -m "feat(worker): enrichOne layers IGDB on top of Steam Store; parallelism 6→3 for IGDB rate limit"
```

---

## Batch 4 — Recommender groupFit factor

### Task 8: `computeGroupFitScore` unit

**Files:**

- Modify: `packages/recommender/src/v2-thumbs.ts`
- Modify: `packages/recommender/tests/v2-thumbs.test.ts`

- [ ] **Step 1: Append failing tests at the end of `packages/recommender/tests/v2-thumbs.test.ts`**

```ts
import { computeGroupFitScore } from '../src/v2-thumbs.js';

describe('computeGroupFitScore', () => {
  test('returns 1.0 inside the optimal range', () => {
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
    expect(computeGroupFitScore({ groupSize: 2, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
    expect(computeGroupFitScore({ groupSize: 6, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
  });

  test('decays at -0.25 per step below the range, floors at 0', () => {
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.75);
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 4, optimalMax: 6 })).toBeCloseTo(0.25);
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 8, optimalMax: 10 })).toBe(0); // floored
  });

  test('decays at -0.15 per step above the range, floors at 0', () => {
    expect(computeGroupFitScore({ groupSize: 7, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.85);
    expect(computeGroupFitScore({ groupSize: 8, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.7);
    expect(computeGroupFitScore({ groupSize: 20, optimalMin: 2, optimalMax: 6 })).toBe(0);
  });

  test('returns 0.5 when optimal range is missing (neutral fallback)', () => {
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: null, optimalMax: null })).toBe(0.5);
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: 2, optimalMax: null })).toBe(0.5);
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: null, optimalMax: 6 })).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/recommender test tests/v2-thumbs.test.ts 2>&1 | tail -10
```

Expected: `computeGroupFitScore is not exported`.

- [ ] **Step 3: Add the function to `packages/recommender/src/v2-thumbs.ts`**

Find the existing `computeNoveltyScore` block and add this directly below it (still above the `rankByThumbs` function):

```ts
export interface GroupFitScoreInput {
  groupSize: number;
  optimalMin: number | null;
  optimalMax: number | null;
}

const GROUP_FIT_DECAY_BELOW = 0.25; // missing-a-friend penalty is sharper
const GROUP_FIT_DECAY_ABOVE = 0.15; // crowd penalty is gentler

/**
 * Score how well the current group size fits a game's optimal range.
 * Returns 1.0 inside [optimalMin, optimalMax]. Below the range we decay at
 * -0.25/step (4-player game with 2 people = 0.5 — feels worse), above at
 * -0.15/step (4-player game with 6 people = 0.7 — they can rotate). Floored
 * at 0. Returns 0.5 (neutral) when IGDB hasn't supplied optimal data.
 */
export function computeGroupFitScore(input: GroupFitScoreInput): number {
  const { groupSize, optimalMin, optimalMax } = input;
  if (optimalMin == null || optimalMax == null) return 0.5;
  if (groupSize >= optimalMin && groupSize <= optimalMax) return 1.0;
  if (groupSize < optimalMin) {
    return Math.max(0, 1 - GROUP_FIT_DECAY_BELOW * (optimalMin - groupSize));
  }
  return Math.max(0, 1 - GROUP_FIT_DECAY_ABOVE * (groupSize - optimalMax));
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/recommender test tests/v2-thumbs.test.ts 2>&1 | tail -8
```

Expected: existing tests + 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/recommender/src/v2-thumbs.ts packages/recommender/tests/v2-thumbs.test.ts
git commit -m "feat(recommender): computeGroupFitScore — asymmetric decay for player-count fit"
```

---

### Task 9: Wire groupFit into `rankByThumbs`

**Files:**

- Modify: `packages/recommender/src/v2-thumbs.ts`
- Modify: `packages/recommender/tests/v2-thumbs.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('rankByThumbs — groupFit factor', () => {
  test('groupFit raises score for games matching group size', () => {
    const candidates: EnrichedGameForRanking[] = [
      {
        id: 'good-fit',
        name: 'Good Fit',
        steamReviewPctPositive: 80,
        metadataSyncedAt: new Date().toISOString(),
        optimalMin: 4,
        optimalMax: 6,
      },
      {
        id: 'bad-fit',
        name: 'Bad Fit',
        steamReviewPctPositive: 80,
        metadataSyncedAt: new Date().toISOString(),
        optimalMin: 1,
        optimalMax: 1,
      },
    ];
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates,
      thumbs: new Map(),
      ownership: new Map([
        ['good-fit', { ownerCount: 4, maxLastPlayed: null }],
        ['bad-fit', { ownerCount: 4, maxLastPlayed: null }],
      ]),
      weights: { thumbs: 0.4, ownership: 0.2, novelty: 0.2, groupFit: 0.2 },
      now: new Date(),
    });
    const goodPick = result.picks.find((p) => p.gameId === 'good-fit')!;
    const badPick = result.picks.find((p) => p.gameId === 'bad-fit')!;
    expect(goodPick.breakdown.groupFit).toBeCloseTo(1.0);
    expect(badPick.breakdown.groupFit).toBeCloseTo(0.55); // 1 - 0.15*3
    expect(goodPick.score).toBeGreaterThan(badPick.score);
  });

  test('groupFit returns 0.5 when optimal_min/max are null (neutral)', () => {
    const candidates: EnrichedGameForRanking[] = [
      {
        id: 'no-data',
        name: 'No Data',
        steamReviewPctPositive: null,
        metadataSyncedAt: null,
        optimalMin: null,
        optimalMax: null,
      },
    ];
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates,
      thumbs: new Map(),
      ownership: new Map([['no-data', { ownerCount: 1, maxLastPlayed: null }]]),
      weights: { thumbs: 0.4, ownership: 0.2, novelty: 0.2, groupFit: 0.2 },
      now: new Date(),
    });
    expect(result.picks[0]!.breakdown.groupFit).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/recommender test tests/v2-thumbs.test.ts 2>&1 | tail -10
```

Expected: TypeScript errors — `optimalMin` not on `EnrichedGameForRanking`, `groupFit` not on weights/breakdown.

- [ ] **Step 3: Update interfaces + scoring loop in `packages/recommender/src/v2-thumbs.ts`**

Find `EnrichedGameForRanking` and extend it:

```ts
export interface EnrichedGameForRanking {
  id: string;
  name: string;
  steamReviewPctPositive: number | null;
  metadataSyncedAt: string | null;
  optimalMin?: number | null; // v2.2 — IGDB-derived player range
  optimalMax?: number | null;
}
```

Find `RankInput`. Update the `weights` field:

```ts
weights: {
  thumbs: number;
  ownership: number;
  novelty: number;
  groupFit: number;
}
```

Find `RankResult`. Update the `breakdown` field:

```ts
picks: Array<{
  gameId: string;
  score: number;
  breakdown: { thumbs: number; ownership: number; novelty: number; groupFit: number };
  flags: GameFlag[];
}>;
weightsUsed: {
  thumbs: number;
  ownership: number;
  novelty: number;
  groupFit: number;
}
```

Find the inner loop in `rankByThumbs` where each candidate's `breakdown` is built. Add `groupFit` next to existing factors:

```ts
const groupFit = computeGroupFitScore({
  groupSize: input.group.size,
  optimalMin: c.optimalMin ?? null,
  optimalMax: c.optimalMax ?? null,
});
const score =
  input.weights.thumbs * thumbsScore +
  input.weights.ownership * ownershipScore +
  input.weights.novelty * noveltyScore +
  input.weights.groupFit * groupFit;
picks.push({
  gameId: c.id,
  score,
  breakdown: { thumbs: thumbsScore, ownership: ownershipScore, novelty: noveltyScore, groupFit },
  flags,
});
```

Update `weightsUsed` in the return statement:

```ts
  return {
    picks: picks.sort(...).slice(0, ...),
    weightsUsed: input.weights,
    coldStart: ...,
  };
```

- [ ] **Step 4: Update existing tests in `v2-thumbs.test.ts` that pass `weights` without `groupFit`**

Search the test file for `weights:`. Add `groupFit: 0` to every weight object that doesn't already have it. (If they're consistently shaped you can use a global find-replace; otherwise edit each test.)

```bash
grep -n "weights: {" packages/recommender/tests/v2-thumbs.test.ts
```

For each match, ensure the object has all four keys: thumbs, ownership, novelty, groupFit.

- [ ] **Step 5: Run all recommender tests**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/recommender test 2>&1 | tail -10
```

Expected: all tests pass including 2 new groupFit-in-rank tests.

- [ ] **Step 6: Commit**

```bash
git add packages/recommender/src/v2-thumbs.ts packages/recommender/tests/v2-thumbs.test.ts
git commit -m "feat(recommender): rankByThumbs adds groupFit factor (asymmetric decay)"
```

---

### Task 10: Export `computeGroupFitScore` from package index

**Files:**

- Modify: `packages/recommender/src/index.ts`

- [ ] **Step 1: Read the current index**

Confirm the v2-thumbs re-export block:

```bash
sed -n '/v2-thumbs/,$p' packages/recommender/src/index.ts
```

- [ ] **Step 2: Update the named exports**

Change the `export { rankByThumbs, ... } from './v2-thumbs.js';` block to include `computeGroupFitScore`:

```ts
export {
  rankByThumbs,
  computeThumbsScore,
  computeOwnershipScore,
  computeNoveltyScore,
  computeGroupFitScore,
} from './v2-thumbs.js';
```

Update the type re-export to include `GroupFitScoreInput`:

```ts
export type {
  RankInput,
  RankResult,
  EnrichedGameForRanking,
  GameFlag as GameFlagV21,
  GroupFitScoreInput,
} from './v2-thumbs.js';
```

- [ ] **Step 3: Workspace typecheck**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 -r typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/recommender/src/index.ts
git commit -m "feat(recommender): export computeGroupFitScore + GroupFitScoreInput"
```

---

## Batch 5 — Worker routes

### Task 11: `GET /api/games/:gameId?groupId=:gid` — game detail for the modal

**Files:**

- Create: `apps/worker/src/routes/games.ts`
- Create: `apps/worker/tests/games-route.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Read how routes are dispatched**

```bash
grep -n "dispatch" apps/worker/src/index.ts | head -20
```

Note the import + dispatch pattern (e.g., `dispatchLibrary`, `dispatchRecommendations`). Mirror it for `dispatchGames`.

- [ ] **Step 2: Write tests**

`apps/worker/tests/games-route.test.ts`:

```ts
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { test, expect, describe, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { signInAsTestUser } from './_helpers/auth.js';
import { createGroup } from './_helpers/groups.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare('DELETE FROM games').run();
  await env.DB.prepare('DELETE FROM game_ownership').run();
  await env.DB.prepare('DELETE FROM groups').run();
  await env.DB.prepare('DELETE FROM group_members').run();
  await env.DB.prepare('DELETE FROM thumbs').run();
});

describe('GET /api/games/:gameId', () => {
  test('returns 401 unauthenticated', async () => {
    const res = await worker.fetch(
      new Request('http://x/api/games/steam-730?groupId=g1'),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  test('returns 403 when user is not in the group', async () => {
    const { cookie } = await signInAsTestUser(env);
    const res = await worker.fetch(
      new Request('http://x/api/games/steam-730?groupId=does-not-exist', {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
  });

  test('returns 404 when game does not exist', async () => {
    const { cookie, userId } = await signInAsTestUser(env);
    const gid = await createGroup(env, userId);
    const res = await worker.fetch(
      new Request(`http://x/api/games/steam-99999?groupId=${gid}`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  test('returns game + groupContext for a valid request', async () => {
    const { cookie, userId } = await signInAsTestUser(env);
    const gid = await createGroup(env, userId);
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, description, genres, has_coop, has_pvp, has_singleplayer)
         VALUES ('steam-730', 'CS2', 730, '2026-01-01', 'auto', 'Tactical shooter', '["Shooter"]', 0, 1, 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, last_played_at, added_at)
         VALUES (?, 'steam-730', 'steam', 600, '2026-04-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
      .bind(userId)
      .run();
    await env.DB.prepare(
      `INSERT INTO thumbs (user_id, group_id, game_id, vote, voted_at) VALUES (?, ?, 'steam-730', 1, '2026-04-15T00:00:00Z')`,
    )
      .bind(userId, gid)
      .run();
    const res = await worker.fetch(
      new Request(`http://x/api/games/steam-730?groupId=${gid}`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { game: any; groupContext: any };
    expect(body.game.id).toBe('steam-730');
    expect(body.game.description).toBe('Tactical shooter');
    expect(body.game.genres).toEqual(['Shooter']);
    expect(body.groupContext.ownerCount).toBe(1);
    expect(body.groupContext.groupSize).toBe(1);
    expect(body.groupContext.members).toHaveLength(1);
    expect(body.groupContext.members[0].userId).toBe(userId);
    expect(body.groupContext.members[0].playtime).toBe(600);
    expect(body.groupContext.yourVote).toBe(1);
    expect(body.groupContext.thumbs.up).toBe(1);
    expect(body.groupContext.thumbs.down).toBe(0);
    expect(body.groupContext.yourPlaytime).toBe(600);
  });
});
```

NOTE: tests use existing `_helpers/auth.ts` and `_helpers/groups.ts` — read them first to ensure the function signatures match. If `signInAsTestUser` returns a different shape, adapt.

```bash
ls apps/worker/tests/_helpers/
cat apps/worker/tests/_helpers/auth.ts apps/worker/tests/_helpers/groups.ts 2>/dev/null | head -60
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/games-route.test.ts 2>&1 | tail -10
```

Expected: 404s on every request (route doesn't exist).

- [ ] **Step 4: Implement `apps/worker/src/routes/games.ts`**

```ts
import { getSessionFromRequest } from '../auth/session-helpers.js';
import type { Env } from '../index.js';

interface RouteCtx {
  request: Request;
  env: Env;
  parts: string[];
}

export async function dispatchGames(ctx: RouteCtx): Promise<Response | null> {
  const { request, env, parts } = ctx;
  if (parts[0] !== 'games' || parts.length !== 2) return null;
  if (request.method !== 'GET') return null;

  const session = await getSessionFromRequest(env.DB, request);
  if (!session) return jsonStatus({ error: 'unauthorized' }, 401);

  const gameId = parts[1]!;
  const url = new URL(request.url);
  const gid = url.searchParams.get('groupId');
  if (!gid) return jsonStatus({ error: 'groupId-required' }, 400);

  const memberRow = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(gid, session.user.id)
    .first();
  if (!memberRow) return jsonStatus({ error: 'forbidden' }, 403);

  const gameRow = (await env.DB.prepare('SELECT * FROM games WHERE id = ?')
    .bind(gameId)
    .first()) as Record<string, unknown> | null;
  if (!gameRow) return jsonStatus({ error: 'not-found' }, 404);

  const sizeRow = (await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?',
  )
    .bind(gid)
    .first()) as { n: number };

  const membersResult = await env.DB.prepare(
    `SELECT u.id AS userId, u.display_name AS displayName, u.avatar_url AS avatarUrl,
            go.playtime_minutes AS playtime, go.last_played_at AS lastPlayed
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       LEFT JOIN game_ownership go ON go.user_id = u.id AND go.game_id = ?
      WHERE gm.group_id = ?`,
  )
    .bind(gameId, gid)
    .all();

  const members = (membersResult.results as Array<Record<string, unknown>>)
    .filter((r) => r.playtime != null)
    .map((r) => ({
      userId: r.userId as string,
      displayName: r.displayName as string,
      avatarUrl: (r.avatarUrl as string | null) ?? null,
      playtime: (r.playtime as number) ?? 0,
      lastPlayed: (r.lastPlayed as string | null) ?? null,
    }));

  const yourVoteRow = (await env.DB.prepare(
    'SELECT vote FROM thumbs WHERE group_id = ? AND user_id = ? AND game_id = ?',
  )
    .bind(gid, session.user.id, gameId)
    .first()) as { vote?: number } | null;

  const thumbsAggRow = (await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)  AS up,
       SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
     FROM thumbs WHERE group_id = ? AND game_id = ?`,
  )
    .bind(gid, gameId)
    .first()) as { up: number | null; down: number | null };

  const yourMember = members.find((m) => m.userId === session.user.id);

  return jsonStatus(
    {
      game: rowToGame(gameRow),
      groupContext: {
        ownerCount: members.length,
        groupSize: sizeRow.n,
        members,
        yourVote: (yourVoteRow?.vote ?? 0) as -1 | 0 | 1,
        thumbs: { up: thumbsAggRow.up ?? 0, down: thumbsAggRow.down ?? 0 },
        yourPlaytime: yourMember?.playtime ?? null,
        yourLastPlayed: yourMember?.lastPlayed ?? null,
      },
    },
    200,
  );
}

function rowToGame(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    steamAppId: r.steam_app_id,
    coverUrl: r.cover_url,
    hasSingleplayer: r.has_singleplayer === 1,
    hasCoop: r.has_coop === 1,
    hasPvp: r.has_pvp === 1,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    optimalMin: r.optimal_min ?? null,
    optimalMax: r.optimal_max ?? null,
    releaseDate: r.release_date,
    metadataSyncedAt: r.metadata_synced_at,
    catalogTier: r.catalog_tier,
    steamReviewScore: r.steam_review_score,
    steamReviewScoreDesc: r.steam_review_score_desc,
    steamReviewPctPositive: r.steam_review_pct_positive,
    steamReviewCount: r.steam_review_count,
    description: r.description ?? null,
    genres: r.genres ? JSON.parse(r.genres as string) : [],
    igdbScreenshotId: r.igdb_screenshot_id ?? null,
  };
}

function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 5: Wire dispatcher into `apps/worker/src/index.ts`**

Add the import at the top (next to other route imports):

```ts
import { dispatchGames } from './routes/games.js';
```

Find the dispatcher chain (look for `dispatchLibrary(`). Add `dispatchGames` to the chain — order doesn't matter as long as it's before any catch-all 404:

```ts
const games = await dispatchGames({ request, env, parts });
if (games) return games;
```

- [ ] **Step 6: Run tests — should pass**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/games-route.test.ts 2>&1 | tail -8
```

Expected: 4 tests pass.

- [ ] **Step 7: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/routes/games.ts apps/worker/tests/games-route.test.ts apps/worker/src/index.ts 2>&1 | tail -3
git add apps/worker/src/routes/games.ts apps/worker/tests/games-route.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): GET /api/games/:gameId — detail + group context for the modal"
```

---

### Task 12: Library route — `?preset=` themed rows

**Files:**

- Modify: `apps/worker/src/routes/library.ts`
- Modify: `apps/worker/tests/library-route.test.ts`

- [ ] **Step 1: Read the current library route filter handling**

You'll touch the section where `filter`, `sort`, and `q` are read from query string and converted into SQL clauses. The new `preset` param is a higher-level convenience that maps to a combination of filter + sort + extra WHERE clauses.

- [ ] **Step 2: Append preset tests**

In `apps/worker/tests/library-route.test.ts`, append:

```ts
describe('GET /groups/:gid/library — ?preset=', () => {
  // Helper: seed two users in a group with three games of varying ownership/playtime/coop/pvp/recency
  async function seedGroup() {
    const { cookie, userId: u1 } = await signInAsTestUser(env, 'u1@x', 'U1');
    const u2 = await createUser(env, 'u2@x', 'U2');
    const gid = await createGroup(env, u1);
    await addMember(env, gid, u2);
    // Game A — owned by both, co-op, recent
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, has_coop, has_pvp, has_singleplayer, steam_review_pct_positive)
         VALUES ('steam-1', 'CoopRecent', 1, '2026-01-01', 'auto', 1, 0, 0, 90)`,
    ).run();
    // Game B — owned by u1 only, pvp, old
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, has_coop, has_pvp, has_singleplayer, steam_review_pct_positive)
         VALUES ('steam-2', 'PvpOld', 2, '2026-01-01', 'auto', 0, 1, 0, 80)`,
    ).run();
    // Game C — owned by both, single, low playtime, high reviews (hidden gem)
    await env.DB.prepare(
      `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, has_coop, has_pvp, has_singleplayer, steam_review_pct_positive)
         VALUES ('steam-3', 'GemSingle', 3, '2026-01-01', 'auto', 0, 0, 1, 95)`,
    ).run();
    // Ownership
    for (const [user, gameId, playtime, lastPlayed] of [
      [u1, 'steam-1', 5000, '2026-04-30T00:00:00Z'],
      [u2, 'steam-1', 3000, '2026-04-29T00:00:00Z'],
      [u1, 'steam-2', 100, '2025-01-01T00:00:00Z'],
      [u1, 'steam-3', 50, '2025-06-01T00:00:00Z'],
      [u2, 'steam-3', 20, '2025-06-01T00:00:00Z'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, last_played_at, added_at)
           VALUES (?, ?, 'steam', ?, ?, '2025-01-01T00:00:00Z')`,
      )
        .bind(user, gameId, playtime, lastPlayed)
        .run();
    }
    return { cookie, gid };
  }

  test('preset=most-owned orders by ownerCount DESC', async () => {
    const { cookie, gid } = await seedGroup();
    const res = await worker.fetch(
      new Request(`http://x/api/groups/${gid}/library?preset=most-owned&limit=10`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as {
      games: Array<{ game: { id: string }; ownerCount: number }>;
    };
    expect(body.games[0]!.ownerCount).toBeGreaterThanOrEqual(body.games[1]!.ownerCount);
  });

  test('preset=co-op returns only has_coop games', async () => {
    const { cookie, gid } = await seedGroup();
    const res = await worker.fetch(
      new Request(`http://x/api/groups/${gid}/library?preset=co-op&limit=10`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as { games: Array<{ game: { id: string; hasCoop: boolean } }> };
    expect(body.games.every((g) => g.game.hasCoop)).toBe(true);
    expect(body.games.find((g) => g.game.id === 'steam-1')).toBeDefined();
  });

  test('preset=pvp returns only has_pvp games', async () => {
    const { cookie, gid } = await seedGroup();
    const res = await worker.fetch(
      new Request(`http://x/api/groups/${gid}/library?preset=pvp&limit=10`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as { games: Array<{ game: { id: string } }> };
    expect(body.games.find((g) => g.game.id === 'steam-2')).toBeDefined();
    expect(body.games.find((g) => g.game.id === 'steam-1')).toBeUndefined();
  });

  test('preset=recent orders by maxLastPlayed DESC', async () => {
    const { cookie, gid } = await seedGroup();
    const res = await worker.fetch(
      new Request(`http://x/api/groups/${gid}/library?preset=recent&limit=10`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as { games: Array<{ game: { id: string } }> };
    expect(body.games[0]!.game.id).toBe('steam-1'); // most recently played
  });

  test('preset=hidden-gems returns games under playtime threshold with high reviews', async () => {
    const { cookie, gid } = await seedGroup();
    // threshold default 600 covers steam-3 (total 70min) but not steam-1 (8000min)
    const res = await worker.fetch(
      new Request(`http://x/api/groups/${gid}/library?preset=hidden-gems&limit=10`, {
        headers: { cookie },
      }),
      env,
      {} as ExecutionContext,
    );
    const body = (await res.json()) as { games: Array<{ game: { id: string } }> };
    expect(body.games.find((g) => g.game.id === 'steam-3')).toBeDefined();
    expect(body.games.find((g) => g.game.id === 'steam-1')).toBeUndefined();
  });
});
```

NOTE: `createUser` and `addMember` helpers may need to be added to `tests/_helpers/auth.ts` and `tests/_helpers/groups.ts` if they don't exist. Read them first; if missing, add minimal helpers:

```ts
// in _helpers/auth.ts
export async function createUser(env: Env, email: string, displayName: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, datetime())',
  )
    .bind(id, email, displayName)
    .run();
  return id;
}
// in _helpers/groups.ts
export async function addMember(env: Env, gid: string, userId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, "member", datetime())',
  )
    .bind(gid, userId)
    .run();
}
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/library-route.test.ts 2>&1 | tail -10
```

Expected: 5 new preset tests fail (preset is ignored, returns full library).

- [ ] **Step 4: Add preset handling to `apps/worker/src/routes/library.ts`**

Find where `filter` and `sort` are read from `url.searchParams`. Add preset parsing above:

```ts
const preset = url.searchParams.get('preset');
let presetFilter: string | null = null;
let presetSort: string | null = null;
let presetExtraWhere: string | null = null;
let presetExtraBinds: unknown[] = [];

if (preset) {
  const playtimeThreshold = readNumber(env, 'WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD', 600);
  if (preset === 'most-owned') {
    presetSort = 'ownerCount DESC, g.name ASC';
  } else if (preset === 'co-op') {
    presetFilter = 'coop';
    presetSort = 'ownerCount DESC, g.name ASC';
  } else if (preset === 'pvp') {
    presetFilter = 'pvp';
    presetSort = 'ownerCount DESC, g.name ASC';
  } else if (preset === 'recent') {
    presetSort = 'maxLastPlayed DESC';
  } else if (preset === 'hidden-gems') {
    // Aggregate playtime per game across the group, low total + high reviews.
    presetExtraWhere = `AND g.steam_review_pct_positive >= 75 AND (
        SELECT COALESCE(SUM(playtime_minutes), 0)
          FROM game_ownership go3
          JOIN group_members gm3 ON gm3.user_id = go3.user_id
         WHERE go3.game_id = g.id AND gm3.group_id = ?
      ) <= ?`;
    presetExtraBinds = [gid, playtimeThreshold];
    presetSort = 'g.steam_review_pct_positive DESC';
  }
}
```

Replace the old filter/sort lookup with preset-aware versions:

```ts
const effectiveFilter = presetFilter ?? filter;
const effectiveSort = presetSort ?? sortMap[sort] ?? sortMap.name;
// ... build filterClauses based on effectiveFilter
```

When binding the SELECT, include `presetExtraBinds` between the existing bind set and limit/offset (following the placement of `presetExtraWhere` in the SQL string).

You may need to import `readNumber` at the top:

```ts
import { readNumber } from '../lib/flags.js';
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/library-route.test.ts 2>&1 | tail -10
```

Expected: existing tests + 5 new preset tests pass.

- [ ] **Step 6: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/routes/library.ts apps/worker/tests/library-route.test.ts apps/worker/tests/_helpers/auth.ts apps/worker/tests/_helpers/groups.ts 2>&1 | tail -3
git add apps/worker/src/routes/library.ts apps/worker/tests/library-route.test.ts apps/worker/tests/_helpers/
git commit -m "feat(worker): library ?preset= — most-owned, co-op, pvp, recent, hidden-gems"
```

---

### Task 13: Recommendations route — pass `optimalMin`/`optimalMax` and `groupFit` weight

**Files:**

- Modify: `apps/worker/src/routes/recommendations.ts`
- Modify: `apps/worker/tests/recommendations-route.test.ts`

- [ ] **Step 1: Append failing test**

In `apps/worker/tests/recommendations-route.test.ts`, add a test that asserts a game with optimal range matching group size scores higher than one with a far-off range (only run if recommendations test file already exists; otherwise skip and add later — confirm with `ls apps/worker/tests/recommendations-route.test.ts`):

```ts
test('groupFit factor surfaces well-fit games above poor-fit ones', async () => {
  const { cookie, userId } = await signInAsTestUser(env, 'u1@x', 'U1');
  const u2 = await createUser(env, 'u2@x', 'U2');
  const u3 = await createUser(env, 'u3@x', 'U3');
  const gid = await createGroup(env, userId);
  await addMember(env, gid, u2);
  await addMember(env, gid, u3);
  await env.DB.prepare(
    `INSERT INTO games (id, name, steam_app_id, metadata_synced_at, catalog_tier, has_coop, optimal_min, optimal_max, steam_review_pct_positive)
       VALUES ('steam-fit', 'GoodFit', 1, '2026-01-01', 'auto', 1, 2, 4, 90),
              ('steam-misfit', 'PoorFit', 2, '2026-01-01', 'auto', 1, 1, 1, 90)`,
  ).run();
  for (const u of [userId, u2, u3]) {
    await env.DB.prepare(
      `INSERT INTO game_ownership (user_id, game_id, source, playtime_minutes, last_played_at, added_at)
           SELECT ?, id, 'steam', 0, NULL, '2026-01-01' FROM games`,
    )
      .bind(u)
      .run();
  }
  const res = await worker.fetch(
    new Request(`http://x/api/groups/${gid}/recommendations`, { headers: { cookie } }),
    env,
    {} as ExecutionContext,
  );
  const body = (await res.json()) as {
    picks: Array<{ game: { id: string }; score: number; breakdown: any }>;
  };
  const fit = body.picks.find((p) => p.game.id === 'steam-fit')!;
  const misfit = body.picks.find((p) => p.game.id === 'steam-misfit')!;
  expect(fit.breakdown.groupFit).toBeCloseTo(1.0);
  expect(misfit.breakdown.groupFit).toBeCloseTo(0.7); // 1 - 0.15*2
  expect(fit.score).toBeGreaterThan(misfit.score);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test tests/recommendations-route.test.ts 2>&1 | tail -10
```

Expected: `breakdown.groupFit` is undefined.

- [ ] **Step 3: Update `apps/worker/src/routes/recommendations.ts`**

Update the `weights` block:

```ts
const weights = {
  thumbs: readNumber(env, 'WWP_WEIGHT_THUMBS', 0.4),
  ownership: readNumber(env, 'WWP_WEIGHT_OWNERSHIP', 0.2),
  novelty: readNumber(env, 'WWP_WEIGHT_NOVELTY', 0.2),
  groupFit: readNumber(env, 'WWP_WEIGHT_GROUPFIT', 0.2),
};
```

Update the `candidates` projection to include `optimalMin`/`optimalMax`:

```ts
const candidates = (candidatesResult.results as Record<string, unknown>[]).map((r) => ({
  id: r.id as string,
  name: r.name as string,
  steamReviewPctPositive: (r.steam_review_pct_positive as number | null) ?? null,
  metadataSyncedAt: (r.metadata_synced_at as string | null) ?? null,
  optimalMin: (r.optimal_min as number | null) ?? null,
  optimalMax: (r.optimal_max as number | null) ?? null,
}));
```

`rankByThumbs` already returns `breakdown.groupFit` after Task 9 — no other changes needed in this file. The `breakdown` field passes through transparently to the API response.

- [ ] **Step 4: Run all worker tests**

```bash
cd /c/QR8/gamenight-os && BETTER_AUTH_SECRET=test npx pnpm@9.15.4 --filter @wwp/worker test 2>&1 | tail -10
```

Expected: ~140+ tests pass (existing + 4 IGDB tests + 4 games-route + 5 library preset + 1 groupFit recommend = 14+ new).

- [ ] **Step 5: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/worker/src/routes/recommendations.ts apps/worker/tests/recommendations-route.test.ts 2>&1 | tail -3
git add apps/worker/src/routes/recommendations.ts apps/worker/tests/recommendations-route.test.ts
git commit -m "feat(worker): recommendations passes optimalMin/Max + groupFit weight to recommender"
```

---

## Batch 6 — Site core components

### Task 14: Add new icons

**Files:**

- Modify: `apps/site/src/components/icons.tsx`

- [ ] **Step 1: Read current icons file**

```bash
cat apps/site/src/components/icons.tsx
```

Note the export style (typically `export function FooIcon(props: { className?: string }) { return <svg ...>...</svg>; }`).

- [ ] **Step 2: Append new icon exports**

Add at the end:

```tsx
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
```

- [ ] **Step 3: Format**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/icons.tsx 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/components/icons.tsx
git commit -m "feat(site): add SearchIcon, SettingsIcon, ChevronLeft/RightIcon, CloseIcon"
```

---

### Task 15: GameCard component variants

**Files:**

- Modify: `apps/site/src/components/GameCard.tsx`

- [ ] **Step 1: Read the current GameCard**

```bash
cat apps/site/src/components/GameCard.tsx
```

Current implementation displays a single horizontal card with name + cover + thumbs. v2.2 needs two variants:

- **default** — used in modals / detailed lists (existing)
- **compact** — fixed-width tile for horizontal-scrolling rows (~160px wide, name overlay on cover, no thumbs UI)

- [ ] **Step 2: Update GameCard signature**

Replace the existing component with:

```tsx
interface GameCardProps {
  game: {
    id: string;
    name: string;
    coverUrl?: string | null;
    igdbScreenshotId?: string | null;
  };
  variant?: 'default' | 'compact';
  onClick?: () => void;
  // Default variant only:
  yourVote?: -1 | 0 | 1;
  thumbsUp?: number;
  thumbsDown?: number;
  ownerCount?: number;
}

export function GameCard({
  game,
  variant = 'default',
  onClick,
  yourVote,
  thumbsUp,
  thumbsDown,
  ownerCount,
}: GameCardProps) {
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group relative h-44 w-32 shrink-0 overflow-hidden rounded border border-border bg-panel transition hover:border-accent focus:border-accent focus:outline-none"
        aria-label={`Open ${game.name}`}
      >
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-bg" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-left">
          <div className="line-clamp-2 text-xs font-medium text-white">{game.name}</div>
        </div>
      </button>
    );
  }

  // default variant — existing behavior, keep current markup
  return (
    <div
      className="flex items-center gap-3 rounded border border-border bg-panel p-3"
      onClick={onClick}
    >
      {/* ... existing default markup, including thumbs counts and ownerCount ... */}
    </div>
  );
}
```

NOTE: Preserve the **existing** default-variant markup verbatim — copy it from the current file into the new component's `default` branch. The compact variant is the only new code.

- [ ] **Step 3: Site typecheck**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site typecheck 2>&1 | tail -5
```

Expected: clean. (If existing call-sites of GameCard break because props became optional, fix them — they should already pass `yourVote`/`thumbsUp`/`thumbsDown` so the typecheck passes.)

- [ ] **Step 4: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/GameCard.tsx 2>&1 | tail -3
git add apps/site/src/components/GameCard.tsx
git commit -m "feat(site): GameCard adds compact variant for Netflix-style row tiles"
```

---

### Task 16: RowSection — horizontally scrolling row of GameCards

**Files:**

- Create: `apps/site/src/components/RowSection.tsx`

- [ ] **Step 1: Implement RowSection**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
import { GameCard } from './GameCard.js';
import { ChevronLeftIcon, ChevronRightIcon } from './icons.js';

interface LibraryItem {
  game: { id: string; name: string; coverUrl?: string | null; igdbScreenshotId?: string | null };
}

interface LibraryResponse {
  games: LibraryItem[];
  total: number;
}

interface RowSectionProps {
  title: string;
  groupId: string;
  preset: 'most-owned' | 'co-op' | 'pvp' | 'recent' | 'hidden-gems';
  limit?: number;
  onCardClick: (gameId: string) => void;
}

export function RowSection({ title, groupId, preset, limit = 20, onCardClick }: RowSectionProps) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get<LibraryResponse>(
          `/api/groups/${groupId}/library?preset=${preset}&limit=${limit}`,
        );
        if (alive) setItems(r.games);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId, preset, limit]);

  function scroll(dir: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  if (error) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-danger">Failed to load: {error}</p>
      </section>
    );
  }
  if (!items) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 w-32 shrink-0 animate-pulse rounded bg-panel" />
          ))}
        </div>
      </section>
    );
  }
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <div className="group relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-bg/80 p-2 text-text shadow group-hover:block"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((it) => (
            <GameCard
              key={it.game.id}
              game={it.game}
              variant="compact"
              onClick={() => onCardClick(it.game.id)}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-bg/80 p-2 text-text shadow group-hover:block"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Site typecheck**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/RowSection.tsx 2>&1 | tail -3
git add apps/site/src/components/RowSection.tsx
git commit -m "feat(site): RowSection — horizontally scrolling row of compact GameCards by preset"
```

---

## Batch 7 — HeroCard + GameDetailModal

### Task 17: HeroCard — full-bleed top of group page

**Files:**

- Create: `apps/site/src/components/HeroCard.tsx`

- [ ] **Step 1: Implement HeroCard**

```tsx
import type { GameV22 } from '@wwp/auth-shared';

interface HeroPick {
  game: GameV22 & { coverUrl: string | null };
  score: number;
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
}

interface HeroCardProps {
  pick: HeroPick | null;
  onSelect: () => void;
}

const IGDB_HERO_BASE = 'https://images.igdb.com/igdb/image/upload/t_1080p';

function heroBackdropUrl(game: HeroPick['game']): string | null {
  if (game.igdbScreenshotId) return `${IGDB_HERO_BASE}/${game.igdbScreenshotId}.jpg`;
  return game.coverUrl ?? null;
}

export function HeroCard({ pick, onSelect }: HeroCardProps) {
  if (!pick) {
    return (
      <div className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded bg-panel">
        <div className="flex h-full items-center justify-center">
          <p className="text-muted">
            No recommendations yet — sync your Steam library to get started.
          </p>
        </div>
      </div>
    );
  }
  const backdrop = heroBackdropUrl(pick.game);
  return (
    <div className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded">
      {backdrop ? (
        <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-panel" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
      <div className="relative flex h-full flex-col justify-end gap-3 p-6 md:p-10 max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-accent">Tonight's pick</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">{pick.game.name}</h1>
        {pick.game.description && (
          <p className="line-clamp-3 text-sm text-white/80 md:text-base">{pick.game.description}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-white/70">
          <span>
            Owned by {pick.ownerCount}/{pick.groupSize}
          </span>
          {pick.thumbs.up > 0 && <span>{pick.thumbs.up} thumbs up</span>}
          {pick.game.genres && pick.game.genres.length > 0 && (
            <span>{pick.game.genres.slice(0, 3).join(' · ')}</span>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={onSelect}
            className="mt-2 inline-flex items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            More info
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/HeroCard.tsx 2>&1 | tail -3
git add apps/site/src/components/HeroCard.tsx
git commit -m "feat(site): HeroCard — full-bleed top pick with IGDB backdrop"
```

---

### Task 18: GameDetailModal

**Files:**

- Create: `apps/site/src/components/GameDetailModal.tsx`

- [ ] **Step 1: Implement GameDetailModal**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';
import type { GameDetailResponse } from '@wwp/auth-shared';
import { CloseIcon, ThumbUpIcon, ThumbDownIcon } from './icons.js';

interface GameDetailModalProps {
  gameId: string | null;
  groupId: string;
  onClose: () => void;
}

const IGDB_HERO_BASE = 'https://images.igdb.com/igdb/image/upload/t_1080p';

export function GameDetailModal({ gameId, groupId, onClose }: GameDetailModalProps) {
  const [data, setData] = useState<GameDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    setData(null);
    setError(null);
    let alive = true;
    (async () => {
      try {
        const r = await api.get<GameDetailResponse>(`/api/games/${gameId}?groupId=${groupId}`);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, groupId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (gameId) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [gameId, onClose]);

  async function vote(v: 1 | -1) {
    if (!data) return;
    setVoting(true);
    try {
      const newVote: -1 | 0 | 1 = data.groupContext.yourVote === v ? 0 : v;
      await api.post(`/api/groups/${groupId}/thumbs`, {
        gameId: data.game.id,
        vote: newVote,
      });
      // Optimistic refetch
      const r = await api.get<GameDetailResponse>(`/api/games/${data.game.id}?groupId=${groupId}`);
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVoting(false);
    }
  }

  if (!gameId) return null;

  const backdrop = data?.game.igdbScreenshotId
    ? `${IGDB_HERO_BASE}/${data.game.igdbScreenshotId}.jpg`
    : (data?.game.coverUrl ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {!data && !error && <div className="p-8 text-center text-muted">Loading…</div>}
        {error && <div className="p-8 text-center text-danger">Failed to load: {error}</div>}
        {data && (
          <>
            <div className="relative h-64 w-full overflow-hidden">
              {backdrop ? (
                <img
                  src={backdrop}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-bg" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <h2 className="text-2xl font-bold text-white">{data.game.name}</h2>
                {data.game.genres && data.game.genres.length > 0 && (
                  <p className="text-xs text-white/70">{data.game.genres.join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4">
              {data.game.description && (
                <p className="text-sm text-text">{data.game.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>
                  Owned by {data.groupContext.ownerCount}/{data.groupContext.groupSize}
                </span>
                {data.game.optimalMin != null && data.game.optimalMax != null && (
                  <span>
                    Optimal {data.game.optimalMin}–{data.game.optimalMax} players
                  </span>
                )}
                {data.game.steamReviewPctPositive != null && (
                  <span>{data.game.steamReviewPctPositive}% positive on Steam</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => vote(1)}
                  aria-label="Thumbs up"
                  className={`rounded border p-2 transition ${
                    data.groupContext.yourVote === 1
                      ? 'border-success bg-success/20 text-success'
                      : 'border-border text-muted hover:text-text'
                  }`}
                >
                  <ThumbUpIcon />{' '}
                  <span className="ml-1 text-xs">{data.groupContext.thumbs.up}</span>
                </button>
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => vote(-1)}
                  aria-label="Thumbs down"
                  className={`rounded border p-2 transition ${
                    data.groupContext.yourVote === -1
                      ? 'border-danger bg-danger/20 text-danger'
                      : 'border-border text-muted hover:text-text'
                  }`}
                >
                  <ThumbDownIcon />{' '}
                  <span className="ml-1 text-xs">{data.groupContext.thumbs.down}</span>
                </button>
              </div>

              {data.groupContext.members.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Who owns it</h3>
                  <ul className="space-y-1 text-xs">
                    {data.groupContext.members.map((m) => (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-2 rounded bg-bg p-2"
                      >
                        <span className="flex items-center gap-2">
                          {m.avatarUrl ? (
                            <img src={m.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-border" />
                          )}
                          <span>{m.displayName}</span>
                        </span>
                        <span className="text-muted">
                          {Math.round(m.playtime / 60)}h
                          {m.lastPlayed
                            ? ` · last ${new Date(m.lastPlayed).toLocaleDateString()}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

NOTE: confirm that `ThumbUpIcon` and `ThumbDownIcon` exist in `icons.tsx`. If not, copy them from `WhosPlayingMinimal.tsx` or `GameCard.tsx`'s existing v2.1 thumbs UI — the icons must already exist somewhere.

- [ ] **Step 2: Site typecheck**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/GameDetailModal.tsx 2>&1 | tail -3
git add apps/site/src/components/GameDetailModal.tsx
git commit -m "feat(site): GameDetailModal — IGDB backdrop, member ownership, thumbs voting"
```

---

## Batch 8 — SearchOverlay

### Task 19: SearchOverlay — top-bar trigger + full-screen overlay

**Files:**

- Create: `apps/site/src/components/SearchOverlay.tsx`

- [ ] **Step 1: Implement SearchOverlay**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
import { SearchIcon, CloseIcon } from './icons.js';

interface LibraryItem {
  game: { id: string; name: string; coverUrl?: string | null };
  ownerCount: number;
}
interface LibraryResponse {
  games: LibraryItem[];
  total: number;
}

interface SearchOverlayProps {
  groupId: string;
  onSelect: (gameId: string) => void;
}

export function SearchOverlay({ groupId, onSelect }: SearchOverlayProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<LibraryResponse>(
          `/api/groups/${groupId}/library?q=${encodeURIComponent(q.trim())}&limit=30`,
        );
        setResults(r.games);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open, groupId]);

  return (
    <>
      <button
        type="button"
        aria-label="Search games"
        onClick={() => setOpen(true)}
        className="rounded p-2 text-muted hover:bg-bg hover:text-text"
      >
        <SearchIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-bg/95 backdrop-blur"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto mt-12 max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 rounded border border-border bg-panel p-3">
              <SearchIcon className="h-4 w-4 text-muted" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search this group's library…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text outline-none"
              />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:text-text"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-1">
              {loading && <p className="p-3 text-sm text-muted">Searching…</p>}
              {!loading && q.trim().length > 0 && results.length === 0 && (
                <p className="p-3 text-sm text-muted">No games match "{q}".</p>
              )}
              {results.map((it) => (
                <button
                  key={it.game.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(it.game.id);
                  }}
                  className="flex w-full items-center gap-3 rounded border border-transparent p-2 text-left hover:border-border hover:bg-panel"
                >
                  {it.game.coverUrl ? (
                    <img
                      src={it.game.coverUrl}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-16 shrink-0 rounded bg-panel" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text">{it.game.name}</div>
                    <div className="text-xs text-muted">Owned by {it.ownerCount}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/SearchOverlay.tsx 2>&1 | tail -3
git add apps/site/src/components/SearchOverlay.tsx
git commit -m "feat(site): SearchOverlay — top-bar trigger + full-screen library search"
```

---

## Batch 9 — GroupHomePage rewrite + GroupSettings page

### Task 20: GroupHomePage rewrite

**Files:**

- Create: `apps/site/src/components/GroupHomePage.tsx`
- Modify: `apps/site/src/pages/groups/[gid].astro`

- [ ] **Step 1: Read the current group page entry point**

```bash
cat apps/site/src/pages/groups/[gid].astro
```

You'll see it currently mounts `<GroupHomeMinimal client:load groupId={...} />`. v2.2 swaps this for a new `GroupHomePage` component (keep `GroupHomeMinimal.tsx` in the tree as fallback if `WWP_FEAT_NETFLIX_UI` flag exists; otherwise delete in this task).

For v2.2 we just replace it cleanly.

- [ ] **Step 2: Implement GroupHomePage**

`apps/site/src/components/GroupHomePage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';
import { HeroCard } from './HeroCard.js';
import { RowSection } from './RowSection.js';
import { GameDetailModal } from './GameDetailModal.js';
import { SearchOverlay } from './SearchOverlay.js';
import { ArrowLeftIcon, SettingsIcon } from './icons.js';

interface RecResponse {
  picks: Array<{
    game: any;
    score: number;
    breakdown: { thumbs: number; ownership: number; novelty: number; groupFit: number };
    flags: string[];
    ownerCount: number;
    groupSize: number;
    thumbs: { up: number; down: number };
    yourVote: -1 | 0 | 1;
  }>;
  generatedAt: string;
  weightsUsed: { thumbs: number; ownership: number; novelty: number; groupFit: number };
  coldStart: boolean;
}

interface GroupHomePageProps {
  groupId: string;
}

export default function GroupHomePage({ groupId }: GroupHomePageProps) {
  const [hero, setHero] = useState<RecResponse['picks'][number] | null>(null);
  const [modalGameId, setModalGameId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<RecResponse>(`/api/groups/${groupId}/recommendations`);
        setHero(r.picks[0] ?? null);
      } catch {
        setHero(null);
      }
    })();
    (async () => {
      try {
        const g = await api.get<{ group: { name: string } }>(`/api/groups/${groupId}`);
        setGroupName(g.group.name);
      } catch {
        // fallthrough — show generic title
      }
    })();
  }, [groupId]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <a
          href="/who"
          className="inline-flex items-center gap-1.5 rounded p-1 text-sm text-muted transition hover:text-text"
        >
          <ArrowLeftIcon /> Dashboard
        </a>
        <h1 className="flex-1 truncate text-center text-lg font-semibold">
          {groupName ?? 'Group'}
        </h1>
        <div className="flex items-center gap-1">
          <SearchOverlay groupId={groupId} onSelect={setModalGameId} />
          <a
            href={`/groups/${groupId}/settings`}
            aria-label="Group settings"
            title="Group settings"
            className="rounded p-2 text-muted transition hover:bg-bg hover:text-text"
          >
            <SettingsIcon className="h-4 w-4" />
          </a>
        </div>
      </header>

      <HeroCard pick={hero} onSelect={() => hero && setModalGameId(hero.game.id)} />

      <div className="space-y-6">
        <RowSection
          title="Most owned"
          groupId={groupId}
          preset="most-owned"
          onCardClick={setModalGameId}
        />
        <RowSection title="Co-op" groupId={groupId} preset="co-op" onCardClick={setModalGameId} />
        <RowSection title="PvP" groupId={groupId} preset="pvp" onCardClick={setModalGameId} />
        <RowSection
          title="Recently played"
          groupId={groupId}
          preset="recent"
          onCardClick={setModalGameId}
        />
        <RowSection
          title="Hidden gems"
          groupId={groupId}
          preset="hidden-gems"
          onCardClick={setModalGameId}
        />
      </div>

      <GameDetailModal
        gameId={modalGameId}
        groupId={groupId}
        onClose={() => setModalGameId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update `apps/site/src/pages/groups/[gid].astro`**

Replace the import + mount of `GroupHomeMinimal` with `GroupHomePage`:

```astro
---
import Layout from '../../layouts/Layout.astro';
import GroupHomePage from '../../components/GroupHomePage.tsx';
const { gid } = Astro.params;
---
<Layout title="Group">
  <main class="mx-auto max-w-6xl p-4">
    <GroupHomePage client:load groupId={gid!} />
  </main>
</Layout>
```

(Adapt to the existing layout import — read the current file first.)

- [ ] **Step 4: Verify build**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write apps/site/src/components/GroupHomePage.tsx apps/site/src/pages/groups/[gid].astro 2>&1 | tail -3
git add apps/site/src/components/GroupHomePage.tsx apps/site/src/pages/groups/[gid].astro
git commit -m "feat(site): Netflix group home — hero + 6 rows + search + settings cog"
```

---

### Task 21: GroupSettings page (Members + Invites + Leave consolidated)

**Files:**

- Create: `apps/site/src/components/GroupSettings.tsx`
- Create: `apps/site/src/pages/groups/[gid]/settings.astro`

- [ ] **Step 1: Read existing minimal group implementation**

```bash
cat apps/site/src/components/GroupHomeMinimal.tsx
```

The Members panel, Invites panel, and Leave button live in `GroupHomeMinimal`. v2.2 lifts them into a dedicated settings page. Copy the JSX + handlers verbatim, then strip the parts that are no longer relevant (game library section, recommendations).

- [ ] **Step 2: Implement GroupSettings**

`apps/site/src/components/GroupSettings.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';
import { ArrowLeftIcon } from './icons.js';

interface GroupResponse {
  group: { id: string; name: string; createdAt: string };
  members: Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    role: 'owner' | 'member';
  }>;
  invites: Array<{
    id: string;
    code: string;
    createdAt: string;
    expiresAt: string | null;
    usesRemaining: number | null;
  }>;
  yourRole: 'owner' | 'member';
}

interface GroupSettingsProps {
  groupId: string;
}

export default function GroupSettings({ groupId }: GroupSettingsProps) {
  const [data, setData] = useState<GroupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.get<GroupResponse>(`/api/groups/${groupId}`);
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, [groupId]);

  async function createInvite() {
    setBusy(true);
    try {
      await api.post(`/api/groups/${groupId}/invites`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm('Revoke this invite?')) return;
    setBusy(true);
    try {
      await api.delete(`/api/groups/${groupId}/invites/${inviteId}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!confirm('Leave this group?')) return;
    setBusy(true);
    try {
      await api.post(`/api/groups/${groupId}/leave`, {});
      window.location.href = '/who';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-muted">{error ?? 'Loading…'}</p>;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <a
          href={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 rounded p-1 text-sm text-muted transition hover:text-text"
        >
          <ArrowLeftIcon /> {data.group.name}
        </a>
      </header>

      <h1 className="text-2xl font-semibold">Group settings</h1>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Members</h2>
        <ul className="divide-y divide-border rounded border border-border bg-panel">
          {data.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-border" />
                )}
                <span className="text-sm">{m.displayName}</span>
              </div>
              <span className="text-xs text-muted">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Invites</h2>
          <button
            type="button"
            onClick={createInvite}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            New invite
          </button>
        </div>
        {data.invites.length === 0 ? (
          <p className="text-sm text-muted">No active invites.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-panel">
            {data.invites.map((iv) => {
              const url = `${window.location.origin}/invite/${iv.code}`;
              return (
                <li key={iv.id} className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={url}
                      className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs text-muted"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="rounded border border-border px-2 py-1 text-xs hover:border-accent"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => revokeInvite(iv.id)}
                      className="rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Danger zone</h2>
        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="rounded border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          Leave group
        </button>
      </section>
    </div>
  );
}
```

NOTE: confirm `GET /api/groups/:gid`, `POST /api/groups/:gid/invites`, `DELETE /api/groups/:gid/invites/:id`, `POST /api/groups/:gid/leave` exist (they do — they back the v2.0 minimal page). If the response shapes differ from `GroupResponse`, adapt the type.

- [ ] **Step 3: Create the page route**

`apps/site/src/pages/groups/[gid]/settings.astro`:

```astro
---
import Layout from '../../../layouts/Layout.astro';
import GroupSettings from '../../../components/GroupSettings.tsx';
const { gid } = Astro.params;
---
<Layout title="Group settings">
  <main class="mx-auto max-w-3xl p-4">
    <GroupSettings client:load groupId={gid!} />
  </main>
</Layout>
```

(Adapt layout import to match existing Astro pages.)

- [ ] **Step 4: Verify build**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Format + commit**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 exec prettier --write "apps/site/src/components/GroupSettings.tsx" "apps/site/src/pages/groups/[gid]/settings.astro" 2>&1 | tail -3
git add "apps/site/src/components/GroupSettings.tsx" "apps/site/src/pages/groups/[gid]/settings.astro"
git commit -m "feat(site): /groups/:gid/settings — members + invites + leave consolidated"
```

---

### Task 22: Remove obsolete `GroupHomeMinimal.tsx`

**Files:**

- Delete: `apps/site/src/components/GroupHomeMinimal.tsx`
- Delete: `apps/site/src/components/WhosPlayingMinimal.tsx` (only if entirely subsumed by HeroCard + GameDetailModal — verify it's not referenced elsewhere)

- [ ] **Step 1: Verify no references remain**

```bash
grep -rn "GroupHomeMinimal\|WhosPlayingMinimal" apps/site/src
```

Expected output: only the file definitions themselves. If anything else references them, leave the file in place and skip this task.

- [ ] **Step 2: Delete files**

```bash
rm apps/site/src/components/GroupHomeMinimal.tsx
# Only if grep showed no other refs:
rm apps/site/src/components/WhosPlayingMinimal.tsx
```

- [ ] **Step 3: Verify build**

```bash
cd /c/QR8/gamenight-os && npx pnpm@9.15.4 --filter @wwp/site build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(site): remove v2.1 GroupHomeMinimal/WhosPlayingMinimal (replaced by Netflix UI)"
```

---

## Batch 10 — CI workflow + production rollout

### Task 23: CI deploy-worker step injects IGDB credentials

**Files:**

- Modify: `.github/workflows/deploy.yml` (or whichever workflow file invokes `wrangler deploy` for the worker)

- [ ] **Step 1: Locate the worker deploy step**

```bash
grep -rn "wrangler deploy\|secret put" .github/workflows/
```

Identify the step that pushes secrets to Cloudflare (typically using `wrangler secret put` or `wrangler deploy` with env vars).

- [ ] **Step 2: Add IGDB credentials to the secret-push step**

In the workflow file, the existing step likely looks like:

```yaml
- name: Push secrets
  run: |
    echo "$BETTER_AUTH_SECRET" | npx wrangler secret put BETTER_AUTH_SECRET --name wwp-worker
    echo "$STEAM_API_KEY" | npx wrangler secret put STEAM_API_KEY --name wwp-worker
    # ... other secrets
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
    STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
```

Append two more lines for IGDB:

```yaml
echo "$IGDB_CLIENT_ID" | npx wrangler secret put IGDB_CLIENT_ID --name wwp-worker
echo "$IGDB_CLIENT_SECRET" | npx wrangler secret put IGDB_CLIENT_SECRET --name wwp-worker
```

And add to the `env:` block:

```yaml
IGDB_CLIENT_ID: ${{ secrets.IGDB_CLIENT_ID }}
IGDB_CLIENT_SECRET: ${{ secrets.IGDB_CLIENT_SECRET }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: push IGDB_CLIENT_ID + IGDB_CLIENT_SECRET to wwp-worker on deploy"
```

---

### Task 24: Production rollout + smoke verification

**Files:** none (operational task)

NOTE: This task involves running migrations against production D1 and verifying the deployed site. The user runs the actual commands; subagents executing this plan should pause and ask for explicit confirmation before running anything that touches production.

- [ ] **Step 1: Apply migration 0006 to remote D1**

```bash
cd /c/QR8/gamenight-os/apps/worker && npx wrangler d1 migrations apply wwp-db --remote
```

Expected: 0006 applied. Migrations 0001-0005 should already be applied on production.

- [ ] **Step 2: Push branch and let CI deploy**

```bash
git push -u origin <branch>
```

Wait for the GitHub Actions workflow to finish. Verify it succeeded:

```bash
gh run list --workflow=deploy.yml --limit 1
```

- [ ] **Step 3: Smoke test the deployed worker**

```bash
curl -s https://wwp-worker.<your-subdomain>.workers.dev/health
```

Expected: 200 OK with health body.

- [ ] **Step 4: Smoke test IGDB token endpoint via worker logs**

Trigger a Steam library sync from the production site (open https://whatweplayin.gg, sign in, link Steam if not linked, click "Refresh library"). Then tail logs:

```bash
cd /c/QR8/gamenight-os/apps/worker && npx wrangler tail wwp-worker --format pretty
```

Expected: no `IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not configured` errors. Look for successful enrichOne completions.

- [ ] **Step 5: Smoke test the new UI**

Navigate to a group page on production. Verify:

- Hero loads with backdrop image
- All 6 rows render (some may be empty if library is small)
- Clicking a card opens the modal with description
- Search button (top-right) opens overlay
- Settings cog navigates to /groups/:gid/settings
- Settings page shows Members + Invites + Leave

- [ ] **Step 6: If smoke fails, flip the IGDB flag off as a quick rollback**

```bash
cd /c/QR8/gamenight-os/apps/worker && npx wrangler deploy --var WWP_FEAT_IGDB:false
```

This disables IGDB calls without redeploying schema. UI degrades gracefully — modal hides description / genres / hero backdrop falls back to coverUrl.

- [ ] **Step 7: After verifying production is healthy, open a PR**

```bash
gh pr create --title "feat: WhatWePlayin v2.2 — Netflix UI + IGDB enrichment + groupFit" --body "$(cat <<'EOF'
## Summary
- Full-bleed Netflix-style group home (hero + 6 themed rows + game-detail modal + search overlay)
- IGDB metadata enrichment via Twitch OAuth (description, genres, screenshot, optimal player counts)
- New `groupFit` recommender factor (asymmetric decay: −0.25 below range, −0.15 above)
- New `/groups/:gid/settings` page consolidating Members / Invites / Leave
- Weights rebalanced: thumbs 0.4 / ownership 0.2 / novelty 0.2 / groupFit 0.2

## Test plan
- [ ] Worker tests pass (`pnpm --filter @wwp/worker test`)
- [ ] Recommender tests pass (`pnpm --filter @wwp/recommender test`)
- [ ] Site builds (`pnpm --filter @wwp/site build`)
- [ ] Migration 0006 applied to remote D1
- [ ] IGDB secrets pushed by CI
- [ ] Smoke: hero, rows, modal, search, settings cog all functional on production

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Save project memory**

After merge, update memory file `crime-rpg-v2.md` (or wherever WhatWePlayin context lives) with:

- "v2.2 shipped" + date
- Note that `WWP_FEAT_IGDB` is the kill-switch
- Note that recommender now has 4 factors (was 3)

---
