# WhatWePlayin v2.1 — Catalog Sync + Thumbs Voting + Recommender

**Status:** approved 2026-05-04, ready for implementation planning
**Predecessor:** v2.0 Foundation (`docs/superpowers/specs/2026-05-03-whatweplayin-v2-netflix-redesign.md`)
**Successor:** v2.2 Netflix UI rebuild (TBD)

## 1. Vision

v2.0 shipped identity + grouping. v2.1 turns the platform into the actual game-night picker. After v2.1, a friend group can: link Steam, see what they collectively own, vote thumbs on what looks fun, and get a ranked top-5 recommendation for tonight's session. The visual polish (Netflix rows, hero card, modal) is deferred to v2.2; v2.1 ships the loop in a minimal but complete UI.

## 2. Scope

### In scope (v2.1)

- **A.** Steam library auto-import on Link Steam + auto-on-login (stale check) + manual refresh
- **C.** New lightweight recommender (separate module from v1) using thumbs + ownership prevalence + novelty
- **D.** Thumbs voting UI (per-game, persistent, per-group)
- **E0.** Steam Store API enrichment (one-time per game) for multiplayer category flags + cover art + Steam reviews — partial subset of original "B" (IGDB enrichment), enough to filter single-player from group recs and label cards

### Deferred to v2.2

- IGDB metadata enrichment (richer descriptions, exact `optimal_min/max` player counts, screenshots)
- Netflix-style row UI (hero, multiple rows, modal-on-click)
- Stable preference sliders (the v1 6-dim onboarding)
- Cron-based catalog refresh
- Per-session voting mode (separate from persistent thumbs)
- E2E Playwright tests for v2 routes

### Deferred indefinitely

- **F.** Session log (record what was actually played) — independent feature, will get its own spec when it's a priority
- Non-Steam library sources (Battle.net, Origin, GOG, Epic, Ubisoft Connect)
- Manual game add for unsupported sources

## 3. Architecture

### 3.1 New modules

**Worker (`apps/worker/src/`):**

| File | Responsibility |
|---|---|
| `lib/steam-sync.ts` | Single function `syncSteamLibrary(env, userId, steamId)` — calls Steam Web API + Store API, writes to `games`/`game_ownership`/`users.steam_library_synced_at`. Sole owner of Steam-API surface; routes never call Steam directly. |
| `routes/recommendations.ts` | `GET /api/groups/:gid/recommendations` |
| `routes/library.ts` | `GET /api/groups/:gid/library` |
| `routes/thumbs.ts` | `PUT/DELETE /api/groups/:gid/games/:gameId/thumb` |
| `routes/config.ts` | `GET /api/config` (returns boolean feature flags for the site) |

**Recommender package (`packages/recommender/src/`):**

| File | Responsibility |
|---|---|
| `v2-thumbs.ts` | Pure function `rankByThumbs(input)`. No D1. No side effects. |

The v1 recommender modules (`score.ts`, `preference-match.ts`, `group-fit.ts`, `session-fit.ts`, `novelty.ts`, `effective-rating.ts`, `rank.ts`, `recommend.ts`) stay untouched. They become legacy / reference material; v2.2 may revive them when stable preference sliders return.

**Site (`apps/site/src/`):**

| File | Responsibility |
|---|---|
| `components/GameCard.tsx` | Canonical card UI used by both Recommended and Library sections |
| `components/GroupHomeMinimal.tsx` (modified) | Adds "Recommended tonight" + "Browse library" sections at the bottom |
| `components/MeSettings.tsx` (modified) | Adds "Last synced · Refresh library" affordance in the Linked accounts row |

### 3.2 Modified workers

- `routes/auth.ts` — Link Steam callback now blocks on initial sync (cheap part) before redirecting; enrichment fans out via `ctx.waitUntil`.
- `routes/me.ts` — adds `POST /api/me/sync/steam` (manual refresh); `GET /api/me` triggers `ctx.waitUntil(syncSteamLibrary(...))` if `users.steam_library_synced_at` is older than `WWP_AUTOSYNC_STALENESS_HOURS` and the feature flag is on.

### 3.3 Boundary discipline

- Routes never call Steam APIs directly. They call into `lib/steam-sync.ts`.
- The recommender module never reads from D1. The route loads data and passes it in.
- Feature flag reads happen at route entry, not deep in business logic. Behavior gated by flags is short-circuited at the route level (returns 503 if disabled).

## 4. Data model

One migration file: `apps/worker/migrations/0005_v21_thumbs_and_steam_reviews.sql`.

### 4.1 New `thumbs` table

```sql
CREATE TABLE thumbs (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  game_id    TEXT NOT NULL REFERENCES games(id),
  vote       INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  voted_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id, game_id)
);

CREATE INDEX idx_thumbs_group_game ON thumbs(group_id, game_id);
CREATE INDEX idx_thumbs_user_game  ON thumbs(user_id, game_id);
```

**Why per-(group, user, game):** a user might want different votes per group (one group is hyped about a genre, another isn't). The same user voting the same game with different signals across groups is a feature, not a bug. Storage cost is negligible.

**No neutral state stored.** Deleting the row = no vote. The `vote` column is constrained to ±1 only.

### 4.2 Extend `games`

```sql
ALTER TABLE games ADD COLUMN steam_review_score        INTEGER;   -- 0-9, Steam's enum
ALTER TABLE games ADD COLUMN steam_review_score_desc   TEXT;      -- "Very Positive", "Mixed", etc.
ALTER TABLE games ADD COLUMN steam_review_pct_positive REAL;      -- 0-100
ALTER TABLE games ADD COLUMN steam_review_count        INTEGER;   -- total review count
```

The existing `games.metadata_synced_at TEXT NOT NULL` column already documents itself as "last IGDB/Steam sync" — we use it for Steam Store API sync time. No new timestamp column needed.

### 4.3 Extend `users`

```sql
ALTER TABLE users ADD COLUMN steam_library_synced_at TEXT;  -- nullable ISO timestamp
```

Lives on `users` (rather than embedded in `oauth_accounts.provider_data` JSON) so the autosync staleness check is a fast indexed read.

### 4.4 Type updates in `packages/auth-shared/src/types.ts`

```ts
export interface Thumb {
  groupId: string;
  userId: string;
  gameId: string;
  vote: -1 | 1;
  votedAt: string;
}

// Extend the existing Game interface
export interface Game {
  // ... existing fields
  steamReviewScore?: number;          // 0-9
  steamReviewScoreDesc?: string;      // "Very Positive"
  steamReviewPctPositive?: number;    // 0-100
  steamReviewCount?: number;
}

// New shape for recommender output
export interface EnrichedGame extends Game {
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
  flags: GameFlag[];
}

export type GameFlag = 'cold-start' | 'low-confidence' | 'not-enriched' | 'never-played';
```

## 5. Sync pipeline

### 5.1 Single entry point

`syncSteamLibrary(env: Env, userId: string, steamId: string): Promise<SyncResult>`

```ts
interface SyncResult {
  gamesAdded: number;       // new rows in `games`
  gamesUpdated: number;     // playtime/last_played refreshed
  ownershipRemoved: number; // games no longer in user's Steam library
  enrichmentDeferred: number; // games queued for ctx.waitUntil enrichment
  syncedAt: string;
}
```

Throws `SteamPrivateProfileError` when `GetOwnedGames` returns no `games` key.

### 5.2 Pipeline steps

```
1. Call Steam Web API: GetOwnedGames?key=KEY&steamid=ID&include_played_free_games=1
   ↓ private profile? → set users.steam_library_synced_at = NOW (so we don't pummel Steam),
                        throw SteamPrivateProfileError, bail
   ↓ network/HTTP error? → throw, caller decides (route returns 502 + retry hint)
   ↓ ok → list of { appid, name, playtime_forever, rtime_last_played }

2. Reconcile game_ownership for this user:
   - Upsert returned games (D1 batch statement)
   - DELETE rows in game_ownership where user_id = ? AND game_id NOT IN (returnedAppIds)
     (Removes games user uninstalled / refunded / region-locked)

3. Identify games NEW to the catalog (not in `games` table yet)

4. For each NEW game (parallel fan-out, max 6 concurrent):
   - GET https://store.steampowered.com/api/appdetails?appids={appid}&filters=basic,categories
     ↓ if data[appid].success !== true OR type !== 'game': cache appid in skipped-set, skip
     ↓ ok → name, header_image, type, categories
   - GET https://store.steampowered.com/appreviews/{appid}?json=1&filter=summary&purchase_type=all&language=all
     ↓ ok → query_summary.{review_score, review_score_desc, total_positive, total_reviews}
     ↓ failure → store NULL for review fields, continue (rating omitted from card; no cold-start blend)
   - INSERT into `games`:
     - id = `'steam-' + appid`
     - name from appdetails
     - steam_app_id = appid
     - cover_url = header_image
     - has_singleplayer = 'Single-player' in categories
     - has_coop = ('Co-op' OR 'Online Co-op' OR 'Shared/Split Screen Co-op') in categories
     - has_pvp = ('PvP' OR 'Online PvP' OR 'Shared/Split Screen PvP') in categories
     - min_players, max_players → defaults (1, 1) for single-player; (1, 8) for has_coop || has_pvp (heuristic)
     - optimal_min, optimal_max → NULL (no IGDB)
     - genres = '[]' (no IGDB)
     - release_status = 'released' (default; could be refined from appdetails if needed)
     - catalog_tier = 'auto'
     - metadata_synced_at = NOW
     - steam_review_* fields from appreviews

5. Update users.steam_library_synced_at = NOW
```

**Skipped-appid cache:** in-memory Map in the worker, keyed by appid → expires after 24h. Prevents re-fetching obviously-not-a-game appids (DLC/soundtrack) on every sync. Worker memory is per-isolate, so this cache is best-effort, not persistent.

### 5.3 Trigger pattern

| Trigger | Flow |
|---|---|
| **Link Steam callback** | Steps 1-2 blocking (~1s for typical library), redirect immediately. Step 4 enrichment via `ctx.waitUntil` — runs after the response is sent. |
| **Auto-on-login** (`/api/me`, stale + flag on) | Full pipeline 1-5 wrapped in `ctx.waitUntil`. User gets `/api/me` response immediately with whatever data already exists; next page load picks up fresh state. |
| **Manual refresh** (`POST /api/me/sync/steam`) | Full pipeline 1-5 BLOCKING. User clicked the button; UI shows spinner. Returns `SyncResult`. |

### 5.4 Idempotency + recovery

- Sync is fully idempotent: re-running on a freshly-killed worker resumes from where the un-enriched games are.
- `metadata_synced_at IS NULL` is the marker for "needs enrichment". Re-runs of step 4 only touch un-enriched games.
- A failed `appreviews` call leaves review fields NULL; `metadata_synced_at` is still set (game IS enriched, just missing optional rating data). Card omits the rating badge when missing.

### 5.5 Steam private profile UX

Caught at the route layer:

| Caller | Behavior |
|---|---|
| Link Steam callback | Redirect to `/who?linkError=steam-private`. Site shows banner with link to Steam privacy settings. |
| `/api/me` autosync (background) | Log + bump `synced_at` (so the staleness check won't keep re-firing). User-facing: nothing — they didn't ask. |
| `POST /api/me/sync/steam` | Return `422 { error: 'steam-private', helpUrl: 'https://steamcommunity.com/my/edit/settings' }`. `/me` UI shows inline error. |

## 6. Worker routes

### 6.1 New routes

#### `GET /api/groups/:gid/recommendations`

Auth: session, requesting user is a member of the group. Returns 401/403 otherwise.

Filters applied in SQL before scoring:

```sql
SELECT DISTINCT g.*
  FROM games g
  JOIN game_ownership go ON go.game_id = g.id
  JOIN group_members  gm ON gm.user_id = go.user_id
 WHERE gm.group_id = ?                                                 -- the group
   AND g.release_status != 'maintenance-mode'
   AND (? = 1 OR g.has_coop = 1 OR g.has_pvp = 1)                      -- ? = (groupSize == 1 ? 1 : 0)
   AND NOT EXISTS (
     SELECT 1 FROM thumbs t
      WHERE t.group_id = ? AND t.game_id = g.id
        AND t.vote = -1
        AND t.voted_at > datetime('now', ?)                            -- ? = '-' || WWP_THUMBS_DOWN_VETO_DAYS || ' days'
   );
```

Recommender then scores, sorts, slices to `WWP_RECOMMENDATIONS_LIMIT` (default 5).

Response:

```ts
{
  picks: Array<{
    game: Game,                    // full row
    score: number,                 // 0..1
    breakdown: { thumbs: number, ownership: number, novelty: number },
    flags: GameFlag[],
    ownerCount: number,
    groupSize: number,
    thumbs: { up: number, down: number },
    yourVote: -1 | 0 | 1,
  }>,
  generatedAt: string,             // ISO timestamp
  weightsUsed: { thumbs: number, ownership: number, novelty: number },
  coldStart: boolean,              // true if group has < 5 total thumbs cast
}
```

Returns `{ picks: [], coldStart: true }` if no candidates pass filters. Returns 503 if `WWP_FEAT_RECOMMENDATIONS = 'false'`.

#### `GET /api/groups/:gid/library`

Auth: session, member.

Query params: `limit` (default 50, max 200), `offset` (default 0), `sort` (`name` | `recent` | `playtime` | `owners`, default `name`), `filter` (`all` | `coop` | `pvp` | `single`, default `all`), `q` (search by name, case-insensitive).

Response:

```ts
{
  games: Array<{
    game: Game,
    ownerCount: number,
    yourVote: -1 | 0 | 1,
    thumbs: { up: number, down: number },
    yourPlaytime?: number,         // minutes, only present if requesting user owns
    yourLastPlayed?: string,       // ISO timestamp
  }>,
  total: number,                   // unfiltered total for pagination math
  limit: number,
  offset: number,
}
```

#### `PUT /api/groups/:gid/games/:gameId/thumb`

Auth: session, member.

Body: `{ vote: 1 | -1 }` (Zod-validated).

```sql
INSERT INTO thumbs (group_id, user_id, game_id, vote, voted_at)
     VALUES (?, ?, ?, ?, NOW)
ON CONFLICT (group_id, user_id, game_id) DO UPDATE
   SET vote = excluded.vote, voted_at = excluded.voted_at;
```

Response: `{ ok: true, vote, votedAt }`. Returns 503 if `WWP_FEAT_THUMBS = 'false'`. Returns 404 if game_id doesn't exist or isn't in any group member's library (prevents thumbing on games not in your catalog).

#### `DELETE /api/groups/:gid/games/:gameId/thumb`

Auth: session, member.

Deletes the row if exists. Idempotent. Response: `{ ok: true }`.

#### `POST /api/me/sync/steam`

Auth: session.

400 if user has no Steam OAuth linked.
422 if Steam profile is private (`SteamPrivateProfileError`).
200 with `SyncResult` on success.

Blocking — full pipeline, may take 5-15s on first sync of a fresh user. UI shows a spinner.

#### `GET /api/config`

Auth: none required (only returns booleans, no sensitive data).

Response:

```ts
{
  flags: {
    autosyncOnLogin: boolean,
    thumbs: boolean,
    recommendations: boolean,
    steamRatings: boolean,
  }
}
```

Site uses this to know what UI to render. Cached on the client for the page lifetime.

### 6.2 Modified routes

- **`GET /api/auth/callback/steam`** (intent=link path): now calls `syncSteamLibrary(...)` blocking before redirect. On `SteamPrivateProfileError` → redirect to `${baseUrl}/who?linkError=steam-private` instead of `?linked=steam`. Enrichment kicks off via `ctx.waitUntil`.
- **`GET /api/me`**: adds, just before the response is built:

```ts
if (
  env.WWP_FEAT_AUTOSYNC_ON_LOGIN === 'true' &&
  hasLinkedSteam(session.user.id) &&
  isStale(session.user.steamLibrarySyncedAt, env.WWP_AUTOSYNC_STALENESS_HOURS)
) {
  ctx.waitUntil(
    syncSteamLibrary(env, session.user.id, getLinkedSteamId(session.user.id))
      .catch((err) => {
        if (err instanceof SteamPrivateProfileError) {
          // already bumps synced_at internally to prevent re-fire
          return;
        }
        console.error('autosync failed:', err);
      }),
  );
}
```

Response shape unchanged.

## 7. Recommender module

### 7.1 Public API

```ts
// packages/recommender/src/v2-thumbs.ts

export function rankByThumbs(input: RankInput): RankResult;

export interface RankInput {
  group:      { id: string; size: number };
  candidates: EnrichedGameForRanking[];
  thumbs:     Map<string, Array<{ userId: string; vote: -1 | 1 }>>;  // game_id → votes
  ownership:  Map<string, { ownerCount: number; maxLastPlayed: string | null }>;
  weights:    { thumbs: number; ownership: number; novelty: number };
  now:        Date;
}

export interface EnrichedGameForRanking {
  id: string;
  name: string;
  steamReviewPctPositive: number | null;   // 0..100, NULL if no review data
  metadataSyncedAt: string | null;         // for not-enriched flag
}

export interface RankResult {
  picks: Array<{
    gameId: string;
    score: number;
    breakdown: { thumbs: number; ownership: number; novelty: number };
    flags: GameFlag[];
  }>;
  weightsUsed: { thumbs: number; ownership: number; novelty: number };
  coldStart: boolean;
}
```

### 7.2 Scoring math

```
thumbsScore (0..1):
  sum   = Σ vote across all members for this game (each up = +1, each down = -1)
  avg   = sum / groupSize
  base  = (avg + 1) / 2          // 0.5 if no thumbs, 1.0 all up, 0.0 all down

  totalGroupThumbs = Σ(thumbs across all games for this group)
  if totalGroupThumbs < 5 AND game.steamReviewPctPositive is not null:
    thumbsScore = 0.5 * base + 0.5 * (steamReviewPctPositive / 100)
  else:
    thumbsScore = base

ownershipScore (0..1):
  ownerCount / groupSize

noveltyScore (0..1):
  if maxLastPlayed is null: 1.0       // nobody's launched it
  daysSince = (now - maxLastPlayed) / DAY
  min(1.0, daysSince / 30)            // linear ramp, plateaus at 30+ days

score = w_thumbs * thumbsScore + w_ownership * ownershipScore + w_novelty * noveltyScore
```

Sort descending by `score`. Tiebreaker (within `0.001`): higher `steamReviewPctPositive`. Final tiebreaker: alphabetical by name.

### 7.3 Flag emission

For each pick:

| Flag | Condition |
|---|---|
| `cold-start` | `totalGroupThumbs < 5` (group-wide signal) |
| `low-confidence` | this game has 0–1 group thumbs |
| `not-enriched` | `metadataSyncedAt` is null |
| `never-played` | `maxLastPlayed` is null |

Multiple flags can apply simultaneously.

### 7.4 What the recommender does NOT do

- Filtering (route's job, in SQL)
- Limit / pagination (route slices to top N)
- D1 reads (caller passes data in)
- Side effects (no logging, no metrics, no DB writes)

## 8. UI surface

### 8.1 `GameCard` component

Rendered identically by both Recommended and Library sections.

```
┌───────────────────────────────────────┐
│  [cover image / placeholder]          │
│                                       │
│  Game Name                            │
│  Very Positive · 12k reviews          │  ← hidden if no review data or flag off
│  Owned by 5/8                         │
│                                       │
│  [👍 12]  [👎 1]                      │  ← current user's vote highlighted
└───────────────────────────────────────┘
```

For low-confidence games (0-1 thumbs), tally is replaced with "no votes yet".

For not-enriched games, cover is a placeholder (Tailwind `bg-panel`) and only the name shows; rating + multiplayer indicators omitted.

Card body is non-interactive. Tapping ↑ or ↓:
- Optimistic UI: update local state immediately
- Fire `PUT /api/groups/:gid/games/:gameId/thumb` with the new vote
- On error: revert + show toast

Tapping the same direction twice: clears the vote (via `DELETE`).

### 8.2 Group page layout

Existing v2.0 sections (Members, Invites, Leave) stay in current positions. New sections append below members and above invites:

```
[group name] · [member count]

Members           ← v2.0 (avatar, name, role)

Recommended tonight  · [refresh icon]              ← NEW
  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
  │ G1  │ │ G2  │ │ G3  │ │ G4  │ │ G5  │       ← horizontal row of GameCards
  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘
  (cold-start label below header if applicable)

Browse library                                      ← NEW
  [All] [Co-op] [PvP] [Single]   [search box]      ← filter chips + search
  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
  │ G1  │ │ G2  │ │ G3  │ │ ... │                  ← grid, paginated (Load More)
  └─────┘ └─────┘ └─────┘ └─────┘

Active invite codes  ← v2.0 (creator-only)

Leave group  ← v2.0
```

Reorganization to a Netflix layout (multiple rows, hero image, modal-on-click) is v2.2. v2.1 keeps it flat and functional.

### 8.3 Empty / cold-start states

| Condition | UI |
|---|---|
| No member has linked Steam | Both new sections collapsed to: *"No libraries linked yet. Have a member link Steam from /me to populate game options."* |
| Library populated, no thumbs in group | Recommended tonight header reads: *"Recommended tonight (using Steam ratings — vote thumbs to personalize)"*. Cards show normally. |
| Recommendations empty after filtering | *"No multiplayer games in the shared library. Try linking more libraries or wait for thumb-down vetoes to lift."* |
| Library empty | *"No games yet. Sync may still be in progress — check back in a moment."* |

### 8.4 `/me` Refresh button

In the existing Steam row of Linked accounts:

```
┌─────────────────────────────────────────────┐
│  Steam · ID 76561… · Alec     [Unlink]      │
│  Last synced: 3 days ago     [Refresh ⟳]    │
└─────────────────────────────────────────────┘
```

`Refresh` button:
- Disabled while syncing
- Shows spinner during the request
- "Synced just now" toast on success
- Inline danger banner on `SteamPrivateProfileError`

### 8.5 Site config consumption

Site fetches `GET /api/config` once on mount of `/who` (or any page that renders feature-gated UI). Stored in component state. Components conditionally render:

```tsx
const { flags } = useConfig();
{flags.recommendations && <RecommendedTonight ... />}
{flags.thumbs && <ThumbsButtons ... />}
```

Site doesn't need backend re-validation — the worker already gates each route on the server side. Client-side flag check is purely for hiding UI affordances when off.

## 9. Feature flags

### 9.1 `apps/worker/wrangler.toml [vars]`

```toml
# Behavior toggles
WWP_FEAT_AUTOSYNC_ON_LOGIN = "true"
WWP_FEAT_THUMBS = "true"
WWP_FEAT_RECOMMENDATIONS = "true"
WWP_FEAT_STEAM_RATINGS = "true"

# Tunables
WWP_AUTOSYNC_STALENESS_HOURS = "6"
WWP_WEIGHT_THUMBS = "0.5"
WWP_WEIGHT_OWNERSHIP = "0.3"
WWP_WEIGHT_NOVELTY = "0.2"
WWP_RECOMMENDATIONS_LIMIT = "5"
WWP_THUMBS_DOWN_VETO_DAYS = "7"
```

All flags read with `env.X === 'true'` semantics; unset / empty string defaults to off (test-time behavior).

### 9.2 `Env` interface additions in `apps/worker/src/index.ts`

```ts
export interface Env {
  // ... existing fields
  WWP_FEAT_AUTOSYNC_ON_LOGIN?: string;
  WWP_FEAT_THUMBS?: string;
  WWP_FEAT_RECOMMENDATIONS?: string;
  WWP_FEAT_STEAM_RATINGS?: string;
  WWP_AUTOSYNC_STALENESS_HOURS?: string;
  WWP_WEIGHT_THUMBS?: string;
  WWP_WEIGHT_OWNERSHIP?: string;
  WWP_WEIGHT_NOVELTY?: string;
  WWP_RECOMMENDATIONS_LIMIT?: string;
  WWP_THUMBS_DOWN_VETO_DAYS?: string;
}
```

### 9.3 `docs/feature-flags.md`

New file. Table format with every flag's name, type (bool/number/string), default, what-on, what-off, notes. Updated whenever a flag is added or removed (PR-required).

Example:

```markdown
| Flag | Type | Default | On | Off | Notes |
|---|---|---|---|---|---|
| `WWP_FEAT_AUTOSYNC_ON_LOGIN` | bool | `true` | `/api/me` triggers `ctx.waitUntil(sync)` if user's Steam library is stale | autosync disabled; manual refresh on /me still works | Set to `false` if Steam Web API rate limits become a concern |
| ... | ... | ... | ... | ... | ... |
```

### 9.4 Auto-disable on failure

Out of scope for v2.1. If a flagged route hits sustained errors, log loudly. Operator manually flips the flag after observing logs. Self-healing is a v3+ concern.

## 10. Edge cases (explicit handling)

| Case | Handling |
|---|---|
| Game removed from Steam library (uninstall, refund) | `DELETE FROM game_ownership WHERE user_id = ? AND game_id NOT IN (returnedAppIds)`. Catalog `games` row stays (useful for other groups). |
| Steam profile becomes private after initial sync | Catalog stays; future syncs surface `SteamPrivateProfileError`. Existing data shows; refreshes fail gracefully. `synced_at` bumps to prevent autosync churn. |
| `appdetails` returns `type !== 'game'` | Skip (no insert). Cache appid in in-memory skipped-set with 24h TTL to avoid re-fetching on next sync of any user. |
| `appreviews` failure for a game | Insert game with NULL review fields. Card omits rating badge. Recommender skips cold-start blend for this game. |
| Sync killed mid-enrichment (worker timeout) | Idempotent. `metadata_synced_at IS NULL` is the marker; next sync resumes on un-enriched games only. |
| Cloudflare `ctx.waitUntil` timeout (~30s) | Parallel fan-out of 6 + idempotent recovery → not a hard failure. Worst case: enrichment lags by one extra sync cycle. |
| Group of 1 (creator alone) | Recommender filter `groupSize > 1` short-circuits to skip multiplayer requirement. Solo cards appear. Same scoring math. |
| Brand-new group, no thumbs anywhere | Cold-start mode. Recommendations driven by Steam rating + ownership prevalence + novelty. |
| User unlinks Steam | Existing `DELETE FROM oauth_accounts` + cascading session pattern stays. Their `game_ownership` rows persist (still useful for group recommendations from owners no longer in the group? — actually no, sync pipeline only writes for users who have linked Steam. Once unlinked, no further sync. Ownership rows stay until v2.2 cleanup if needed.) |
| Recommender returns < 5 picks | UI renders what's there. No padding. |
| Thumb-vote on a game not in any member's library | `PUT` returns 404. Prevents random thumb-DB pollution. |
| Concurrent thumbs (user clicks twice fast) | Optimistic UI update + UPSERT. Last write wins; no special handling needed. |

## 11. Testing strategy

### 11.1 New tests (target ~44 new tests; brings worker from 81 → ~125)

| File | Tests | Style |
|---|---|---|
| `apps/worker/tests/steam-sync.test.ts` | ~10 | Mock fetch via injected `fetchImpl`. Cover: happy path / private profile / partial enrichment failure / DLC skip / removed-game cleanup. |
| `apps/worker/tests/recommendations-routes.test.ts` | ~6 | Seed groups + games + thumbs. Hit route. Assert ordering + flags + cold-start mode. |
| `apps/worker/tests/library-routes.test.ts` | ~5 | Pagination, sort, filter chips, search query. |
| `apps/worker/tests/thumbs-routes.test.ts` | ~6 | PUT/DELETE happy path, 401 unauth, 403 non-member, 400 invalid vote, 404 game-not-in-catalog, idempotent delete. |
| `apps/worker/tests/config-route.test.ts` | ~2 | Flag surface, env var combinations. |
| `packages/recommender/tests/v2-thumbs.test.ts` | ~15 | Pure unit. No D1. Cover all flag conditions, cold-start blend, tiebreaker, edge cases. |
| **Total** | **~44** | |

### 11.2 Existing tests

All 81 v2.0 worker tests must still pass after the v2.1 batch lands. Any failures = signal of regression, not migration.

### 11.3 Site tests

E2E (Playwright) deferred to v2.2 with the Netflix UI rebuild. v2.1 site verification:
- `pnpm --filter @wwp/site build` clean
- `pnpm --filter @wwp/site typecheck` clean
- Manual smoke per deploy: link Steam → see library populate → thumbs vote → recommendations show

### 11.4 Integration smoke after deploy

After v2.1 deploys to production, manual smoke checklist (no automation):
1. `curl https://api.whatweplayin.gg/api/config` returns flags
2. Link Steam (if not already) → /who shows your library populating
3. Thumbs up/down a few games → see vote tallies update
4. Reload group page → "Recommended tonight" shows your thumbs reflected in the ranking
5. Click Refresh on /me → spinner → "Synced just now"
6. (Optional) Unlink + re-link Steam → confirm sync re-fires cleanly

## 12. Migration / rollout

### 12.1 Forward migration

1. Apply `0005_v21_thumbs_and_steam_reviews.sql` via the existing CI deploy pipeline (`Apply D1 migrations (remote)` step in `deploy-worker`).
2. Deploy worker code with new routes + sync module.
3. Pages auto-rebuilds with new site components.
4. First sync for existing users: triggered automatically the next time they hit `/api/me` (autosync flag on by default + their `steam_library_synced_at` is NULL → stale → fires).

### 12.2 Backward compatibility

- v2.0 routes unchanged in behavior.
- v1 `/groups/<gid>/*` routes (group-secret legacy) still preserved in `apps/worker/src/index.ts`.
- v1 recommender package modules untouched; importable, just not used by v2.1 routes.

### 12.3 Rollback

If v2.1 misbehaves in production:
1. Set all `WWP_FEAT_*` flags to `"false"` in wrangler.toml + redeploy. New routes return 503; UI hides the new sections. v2.0 functionality unaffected.
2. Migration can stay applied (additive; no data loss for v2.0).
3. If a deeper revert is needed: `git revert` the v2.1 commits, redeploy.

### 12.4 Feature flag flip cost

Each flag flip is a wrangler.toml edit + commit + push + ~30s deploy. No downtime; new requests use new flag values immediately.

## 13. Risks / open questions

### 13.1 Steam API rate limits

- Steam Web API: 100k requests/day per API key. We use it for `GetOwnedGames` only (1 call per user sync). At our scale: trivial.
- Steam Store API (`appdetails`, `appreviews`): no documented limit, but ~200 req/5min per IP is conventional wisdom. With 8 users × ~200 games × ~50% catalog overlap = ~800 unique enrichment passes for a brand-new deployment. At 6-way parallel, ~2-3 minutes total. Within reason; if we hit 429s we add retry-with-backoff in v2.1.1.

### 13.2 `ctx.waitUntil` worker timeout

Cloudflare may kill the worker after 30s in `waitUntil`. Mitigated by 6-way parallelism (most enrichment finishes in 5-10s) + idempotency (next sync resumes). Risk: in pathological cases (slow Steam API), enrichment lags by one autosync cycle. Acceptable.

### 13.3 Recommender weights

Defaults are 0.5/0.3/0.2 (thumbs/ownership/novelty). These are guesses, not data-driven. After two weeks of real use, observe which games rank where, adjust env vars. No code change required.

### 13.4 Cold-start filler accuracy

Steam ratings are absolute quality, not group-fit. A 95% positive co-op game (Valheim) should rank above a 95% positive single-player (Stardew Valley) for an 8-player group — but the `has_coop || has_pvp` filter handles that. Among the kept ones, Steam rating is a reasonable filler for the cold-start period. Once thumbs accumulate, we trust the group entirely. Risk that the cold-start period feels "off" until ~5 thumbs are cast; mitigated by the cold-start label on the section header so users know what's happening.

### 13.5 Thumbs-down 7-day veto

Heuristic. Long enough to keep "we said no last weekend" effective; short enough that the same game can return for a fresh consideration. Tunable via `WWP_THUMBS_DOWN_VETO_DAYS`. May want shorter (3 days) or longer (14 days) after observing real use.

### 13.6 Single-player games owned by a group

Filter `has_coop || has_pvp` (when group size > 1) excludes solo games from group recommendations. Library section keeps showing them (you can still browse what you own). Some games that are technically multi-player but pragmatically solo (MMOs played alone, asymmetric games) may slip through. v2.1 accepts this; v2.2 with IGDB metadata can filter more precisely.

### 13.7 Privacy / shared visibility

Group members can see what each other owns and how each other voted. This is intentional and aligned with the friend-group design. Documented in the v2.0 spec; v2.1 doesn't change the contract.

## 14. Roadmap context

| Version | Scope |
|---|---|
| v2.0 (shipped) | Auth, groups, invites, sessions, /me settings |
| **v2.1 (this spec)** | **Steam library sync, lightweight recommender, thumbs voting, minimal UI** |
| v2.2 (next) | Netflix UI rebuild: hero, multiple rows, modal cards, IGDB metadata, optional cron-based catalog refresh |
| v2.3+ | Stable preference sliders revival, additional library sources, session log |
