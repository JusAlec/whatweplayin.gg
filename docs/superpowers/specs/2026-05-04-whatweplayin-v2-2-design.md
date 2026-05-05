# WhatWePlayin v2.2 — Netflix UI Rebuild + IGDB Metadata Enrichment

**Status:** approved 2026-05-04, ready for implementation planning
**Predecessor:** v2.1 Foundation (`docs/superpowers/specs/2026-05-04-whatweplayin-v2-1-design.md`)
**Successor:** v2.3+ (TBD)

## 1. Vision

v2.1 shipped the picker loop: link Steam, see your library, vote thumbs, get top-5 recommendations. The data is in place but the visual presentation is functional-only. v2.2 turns the platform into something that feels like a Netflix-style home screen — a full-bleed hero card driven by the recommender, six themed rows of swipeable game cards, click-to-open detail modal with rich metadata. IGDB enrichment supplies the descriptions, genres, screenshots, and exact player counts the new UI needs.

After v2.2, opening the group page feels like browsing a streaming service rather than reading a list.

## 2. Scope

### In scope (v2.2)

- **A. Netflix UI rebuild** — replace v2.1's two-section layout with a hero card, 6 themed rows, full-screen game detail modal, and full-screen search overlay reachable from the top header
- **B. IGDB metadata enrichment** — Twitch OAuth client-credentials, single-call-per-game IGDB lookup, layered enrichment (Steam Store + IGDB additive)
- **C. `groupFit` recommender factor** — uses the IGDB-populated `optimal_min`/`optimal_max` columns; recommender weights rebalance to add a 4th factor
- **D. Group settings page** — `Members` / `Invites` / `Leave/Delete group` move from the v2.1 inline rendering to a dedicated `/groups/:gid/settings` route, accessed via the cog icon in the top header

### Deferred to v2.3+

- IGDB screenshot gallery in the modal (additional IGDB call per game; defer to keep v2.2's subrequest budget tight)
- Stable preference sliders (the v1 6-dim onboarding) — independent feature
- Cron-based catalog refresh — D1 cron handler is still empty; revisit when staleness becomes a problem
- Per-session voting mode (separate from persistent thumbs) — independent feature
- Genre filter chip in SearchOverlay — extends the existing 4 chips; defer to filter-enhancement work in #28
- Steam-rating tier filter, ownership-prevalence filter — also tracked in #28
- E2E Playwright tests for v2 routes
- Profile-menu dropdown for the SignOut icon (Netflix-style profile selector) — UX polish, defer

### Deferred indefinitely

- Session log (record what was actually played) — independent feature
- Non-Steam library sources (Battle.net, Origin, GOG, Epic, Ubisoft Connect)

## 3. Architecture overview

No structural shift from v2.1. Same worker / D1 / Astro SSR shape. v2.2 adds:

- One new HTTP boundary: IGDB API via Twitch OAuth
- Five new columns on the `games` table + one new singleton table for OAuth token caching
- One new worker route (`GET /api/games/:gameId`) for the modal
- One existing route extended (`GET /api/groups/:gid/library` gains a `?preset=` query param)
- New site components: HeroCard, RowSection, GameDetailModal, SearchOverlay, GroupSettings
- Site page rewrite: `/groups/:gid` from the v2.1 minimal layout to the new Netflix-style layout
- New site page: `/groups/:gid/settings`
- One new icon: SearchIcon
- Recommender gains one new scoring component (`computeGroupFitScore`) integrated into `rankByThumbs`

### 3.1 Module inventory

**Worker:**

| File                                                | Status | Purpose                                                                                           |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `apps/worker/src/lib/igdb-api.ts`                   | new    | Twitch OAuth + IGDB games-endpoint wrapper. Cached app token in D1 with auto-refresh.             |
| `apps/worker/src/lib/steam-sync.ts`                 | extend | `enrichOne()` calls Steam Store + new IGDB step. `WWP_ENRICHMENT_MAX_PER_RUN` drops 20 → 13.      |
| `apps/worker/src/lib/d1-client.ts`                  | minor  | Row mapper extensions for new game columns; igdb_token table accessor.                            |
| `apps/worker/src/routes/games.ts`                   | new    | `GET /api/games/:gameId?groupId=:gid` returns full game + group context for modal.                |
| `apps/worker/src/routes/library.ts`                 | extend | Add `?preset=<row-id>` query param for themed-row queries.                                        |
| `apps/worker/src/routes/recommendations.ts`         | minor  | Pass `groupSize` + `optimalMin`/`optimalMax` into recommender.                                    |
| `apps/worker/migrations/0006_v22_igdb_metadata.sql` | new    | Adds `description`, `genres`, `igdb_screenshot_id` columns; creates `igdb_token` singleton table. |
| `apps/worker/wrangler.toml`                         | extend | Two new vars: `WWP_FEAT_IGDB`, `WWP_WEIGHT_GROUPFIT`. Rebalanced weights.                         |
| `apps/worker/src/index.ts`                          | minor  | Env interface extensions; new dispatcher for `routes/games.ts`.                                   |
| `.github/workflows/test.yml`                        | extend | secrets-push for-loop adds `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`.                                |

**Recommender:**

| File                                    | Status | Purpose                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `packages/recommender/src/v2-thumbs.ts` | extend | New `computeGroupFitScore` helper; `rankByThumbs` integrates as 4th factor. |

**Site:**

| File                                              | Status                              | Purpose                                                                                    |
| ------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/site/src/pages/groups/[gid]/index.astro`    | rewrite                             | Renders new `GroupHomePage.tsx`.                                                           |
| `apps/site/src/pages/groups/[gid]/settings.astro` | new                                 | New route for group settings.                                                              |
| `apps/site/src/components/GroupHomePage.tsx`      | renamed from `GroupHomeMinimal.tsx` | Layout: hero + 6 rows.                                                                     |
| `apps/site/src/components/GroupSettings.tsx`      | new                                 | Members + Invites + Leave/Delete moved here from v2.1 inline.                              |
| `apps/site/src/components/HeroCard.tsx`           | new                                 | Full-bleed hero with backdrop image, genre pills, description, thumbs, "Open details" CTA. |
| `apps/site/src/components/RowSection.tsx`         | new                                 | Generic horizontal-scroll row component.                                                   |
| `apps/site/src/components/GameDetailModal.tsx`    | new                                 | Click-to-open overlay with full game + group context.                                      |
| `apps/site/src/components/SearchOverlay.tsx`      | new                                 | Full-screen search + filter chips + paginated results.                                     |
| `apps/site/src/components/GameCard.tsx`           | extend                              | Optional `compact` prop for row variant.                                                   |
| `apps/site/src/components/icons.tsx`              | extend                              | New `SearchIcon`.                                                                          |
| `apps/site/src/components/MeSettings.tsx`         | unchanged                           | (Cog icon already navigates to /me on /who; behavior preserved.)                           |

### 3.2 Boundary discipline

- IGDB calls live exclusively in `lib/igdb-api.ts`. Routes never hit IGDB directly.
- The recommender stays pure: no D1 reads, no side effects. Routes pass data in.
- Feature flag reads happen at route entry. Behavior gated by flags is short-circuited at the route level.
- Modal data fetching is one round-trip per modal-open via `GET /api/games/:gameId` — never N+1 from row-data.

## 4. Data model

One migration: `apps/worker/migrations/0006_v22_igdb_metadata.sql`.

### 4.1 Extend `games` with IGDB metadata

```sql
ALTER TABLE games ADD COLUMN description TEXT;                  -- IGDB summary, ~100-500 chars
ALTER TABLE games ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'; -- JSON array of name strings, e.g. ["Action","Co-op"]
ALTER TABLE games ADD COLUMN igdb_screenshot_id TEXT;           -- IGDB image_id for hero backdrop
```

The existing `optimal_min`/`optimal_max` columns from migration 0004 (added but never populated) start getting filled by IGDB enrichment. No schema change for those.

`metadata_synced_at` from migration 0005 stays as the Steam-Store-enriched marker. IGDB-enrichment status is derived: `description IS NULL` → not yet IGDB-enriched. We don't add a separate `igdb_synced_at` column to keep the schema lean. Auto-loop already iterates over un-enriched games; a NULL description signals work to do regardless of which source last touched the row.

### 4.2 New `igdb_token` table for OAuth caching

```sql
CREATE TABLE igdb_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  access_token TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
```

Single row holds the current Twitch OAuth token. `getIGDBToken(env)` reads the row; if expiring within 24h, refreshes via Twitch and `INSERT OR REPLACE`. Race: if two simultaneous requests both find an expiring token, both refresh — wasteful but harmless (Twitch returns the same token until rotated; both writes converge).

### 4.3 Type updates in `packages/auth-shared/src/types.ts`

Extend the existing `Game` interface (or add a `GameV22` extension):

```ts
export interface GameV22 extends GameV21 {
  description: string | null;
  genres: string[]; // parsed from JSON column
  igdbScreenshotId: string | null;
  optimalMin: number | null; // existing column, now actually populated
  optimalMax: number | null; // existing column, now actually populated
}
```

### 4.4 Recommender input shape extension

```ts
interface EnrichedGameForRanking {
  // existing v2.1 fields
  id: string;
  name: string;
  steamReviewPctPositive: number | null;
  metadataSyncedAt: string | null;
  // new in v2.2
  optimalMin: number | null;
  optimalMax: number | null;
}
```

## 5. IGDB integration

### 5.1 Auth: Twitch OAuth client credentials

POST to `https://id.twitch.tv/oauth2/token` with:

- `client_id` from env
- `client_secret` from env
- `grant_type=client_credentials`

Response: `{ access_token, expires_in, token_type }`. `expires_in` is seconds (~60 days for Twitch app tokens).

`getIGDBToken(env)` flow:

1. Read singleton row from `igdb_token`.
2. If row exists AND `expires_at` is at least 24h in the future → return cached `access_token`.
3. Otherwise call Twitch, parse response, INSERT OR REPLACE the singleton row, return new token.

Token refresh costs 1 subrequest, only when stale. Negligible against the per-call budget.

### 5.2 IGDB game lookup (single call per game via Steam app ID)

IGDB's `external_games` endpoint maps third-party IDs (Steam, GOG, Epic) to IGDB game IDs. APICalypse supports filtering through nested relations, so we get away with **one HTTP call per game** instead of two:

```
POST https://api.igdb.com/v4/games
Client-ID: <client_id>
Authorization: Bearer <token>

fields name, summary, genres.name,
       multiplayer_modes.online_max, multiplayer_modes.online_coop_max, multiplayer_modes.lan_max,
       cover.image_id, screenshots.image_id;
where external_games.category = 1 & external_games.uid = "<steam_app_id>";
limit 1;
```

`category = 1` is IGDB's enum value for Steam. Field expansion (`genres.name`) returns name strings inline — no separate genre-lookup table to cache. `multiplayer_modes.*` returns the full nested object. `cover.image_id` and `screenshots.image_id` give us image references for the modal.

Response is a JSON array; we use `data[0]` (limit 1). If empty → game not in IGDB; leave fields NULL.

### 5.3 Integration into `enrichOne` in `steam-sync.ts`

Per-game enrichment becomes a 3-step pipeline:

1. Steam Store `appdetails` (existing) — populates `name`, `cover_url`, `has_singleplayer`, `has_coop`, `has_pvp`, `release_date`
2. Steam Store `appreviews` (existing) — populates `steam_review_*`
3. **IGDB games query** (new, gated by `WWP_FEAT_IGDB`) — populates `description`, `genres`, `igdb_screenshot_id`, `optimal_min`, `optimal_max`

Single D1 UPDATE statement at the end of `enrichOne` writes all fields. `metadata_synced_at` is set as before. IGDB fields that returned NULL (game not in IGDB or IGDB call failed) stay NULL — graceful degradation.

### 5.4 Optimal player count derivation

IGDB's `multiplayer_modes` is an array (different modes per game — campaign, online, LAN). Derive:

```ts
function deriveOptimalPlayerCount(
  modes: IGDBMultiplayerMode[],
  hasSinglePlayer: boolean,
): {
  min: number | null;
  max: number | null;
} {
  if (!modes || modes.length === 0) {
    return { min: null, max: null }; // unknown — UI degrades gracefully, recommender treats as 0.5 neutral
  }
  let max = 0;
  for (const mode of modes) {
    max = Math.max(max, mode.online_max ?? 0, mode.online_coop_max ?? 0, mode.lan_max ?? 0);
  }
  if (max === 0) return { min: null, max: null };
  const min = hasSinglePlayer ? 1 : 2;
  return { min, max };
}
```

Pragmatic mapping: real "optimal" data isn't in IGDB; we derive it from technical max. Most games are correctly classified (Valheim → 1-10, Among Us → 4-15, Stardew → 1-4). Outliers can be hand-corrected later via a curated catalog tier (already supported by `catalog_tier='curated'` in the schema, not used in v2.2).

### 5.5 Rate limit handling

IGDB caps at 4 req/sec per app token. v2.1's enrichment fans out 6 in parallel — would violate this.

**Drop `enrichmentParallelism` default from 6 to 3** in `enrichOne`. Auto-loop runs ~30% slower per round but stays under the rate limit. For a 250-game library: ~250 × 3 calls / 13 games per invocation × ~3s per invocation ≈ 60s background loop. Manageable for one-time enrichment cost.

### 5.6 Failure modes

| Failure                                                | Behavior                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Token refresh fails (Twitch down or bad credentials)   | Skip IGDB step for this game; Steam fields still populate. Log warning. Description stays NULL.                      |
| Game not in IGDB                                       | `data[0]` is undefined; leave IGDB fields NULL on this game. UI degrades to Steam-only display.                      |
| 429 rate limit                                         | Treat as transient skip; mark game un-enriched (`description IS NULL`); next auto-loop round retries.                |
| Missing `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` in env | Whole IGDB step skipped (token request would fail anyway). Log info. Useful for local dev without Twitch app set up. |
| `WWP_FEAT_IGDB="false"`                                | enrichOne skips the IGDB call entirely. Catalog continues Steam-only.                                                |
| IGDB API parse error                                   | Treat as game-not-found; skip that game.                                                                             |

### 5.7 Subrequest budget

Per worker invocation, free tier 50-cap:

| Source                   | Calls per game |
| ------------------------ | -------------- |
| Steam Store `appdetails` | 1              |
| Steam Store `appreviews` | 1              |
| IGDB `games`             | 1              |
| **Total per game**       | **3**          |

Plus 1 for `GetOwnedGames` per worker invocation. Plus occasional Twitch token refresh (1 per ~60 days).

`WWP_ENRICHMENT_MAX_PER_RUN` drops from 20 → 13. (`13 × 3 + 1 = 40`, well under 50.)

### 5.8 User action required (one-time, before deploy)

Already done: GitHub Secrets `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` populated with Twitch dev app credentials.

Implementation will update `.github/workflows/test.yml` deploy-worker job's secrets-push for-loop to include both new secrets so they're auto-pushed to the worker on every main deploy.

## 6. Recommender upgrade: `groupFit` factor

### 6.1 New formula

```
score = thumbsScore       * 0.4     // was 0.5
      + ownershipScore    * 0.2     // was 0.3
      + noveltyScore      * 0.2     // unchanged
      + groupFitScore     * 0.2     // new
```

All weights tunable via `WWP_WEIGHT_*` env vars. Defaults sum to 1.0 for sanity.

### 6.2 `computeGroupFitScore` math

```ts
export function computeGroupFitScore(input: {
  groupSize: number;
  optimalMin: number | null;
  optimalMax: number | null;
}): number {
  if (input.optimalMin === null || input.optimalMax === null) {
    return 0.5; // missing data — neutral, don't penalize
  }
  if (input.groupSize >= input.optimalMin && input.groupSize <= input.optimalMax) {
    return 1.0; // perfect fit
  }
  if (input.groupSize < input.optimalMin) {
    const distance = input.optimalMin - input.groupSize;
    return Math.max(0, 1 - distance * 0.25); // -0.25 per missing player
  }
  // groupSize > optimalMax
  const distance = input.groupSize - input.optimalMax;
  return Math.max(0, 1 - distance * 0.15); // -0.15 per extra player
}
```

Asymmetric decay (steeper for "too few") matches reality: a group of 6 can split a 2-4 player game into two instances; a group of 2 can't fill a 5-10 player game.

### 6.3 Filter still does the hard cut

The v2.1 hard filter `if groupSize > 1: must have has_coop OR has_pvp` stays. Single-player games never appear for groups; `groupFitScore` only differentiates among multiplayer-eligible candidates.

### 6.4 Defaults during the IGDB enrichment transition

Until IGDB enrichment runs on a given game, `optimal_min`/`optimal_max` stay NULL → `groupFitScore` returns 0.5 (neutral). Contribution to total: `0.5 × 0.2 = 0.1`. Compared to the v2.1 formula (no groupFit term), every un-enriched game gets +0.1 added uniformly — order doesn't fundamentally change. Once IGDB enriches a game, its score moves up or down based on actual fit.

Smooth deployment: rolling out v2.2 doesn't suddenly reorder cold-start recommendations.

### 6.5 Test coverage

Extend `packages/recommender/tests/v2-thumbs.test.ts` with ~6 new tests:

- `computeGroupFitScore` — perfect fit / below range with various distances / above range with various distances / missing data → 0.5 / decay reaches 0 at extreme distance
- `rankByThumbs` integration — game with `optimal_min/max=2-4` ranks higher for a 4-player group than a game with `optimal_min/max=8-10`
- `rankByThumbs` regression — existing 3-factor behavior continues to pass with new weights

## 7. UI architecture

### 7.1 Page layout for `/groups/:gid`

```
┌─────────────────────────────────────────────────────────┐
│ ← All groups    Group Name             [🔍] [⚙] [⏻]    │
├─────────────────────────────────────────────────────────┤
│      [full-bleed IGDB backdrop, ~320px tall]            │
│      Game Name (large)                                  │
│      [Co-op] [Survival]   ← genre pills from IGDB       │
│      Description from IGDB                              │
│      Very Positive · 12k · Owned by 6/8                 │
│      [👍 4]  [👎 1]            [Open details ↗]         │
├─────────────────────────────────────────────────────────┤
│ Recommended tonight                  [↻]                │
│ [card] [card] [card] [card] [card] →                    │
├─────────────────────────────────────────────────────────┤
│ Most-owned                                              │
│ [card] [card] [card] [card] [card] →                    │
├─────────────────────────────────────────────────────────┤
│ Co-op classics                                          │
├─────────────────────────────────────────────────────────┤
│ PvP tonight                                             │
├─────────────────────────────────────────────────────────┤
│ Recently played                                         │
├─────────────────────────────────────────────────────────┤
│ Hidden gems                                             │
└─────────────────────────────────────────────────────────┘
```

Six themed rows + hero. No bottom grid (search overlay handles browse-everything). No utility strip (cog icon → `/groups/:gid/settings`).

### 7.2 Header icons

| Icon                     | Action                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **🔍** SearchIcon        | Opens SearchOverlay (full-screen on mobile, centered modal on desktop)                                    |
| **⚙** SettingsIcon (cog) | Context-aware: on `/groups/:gid/*` → navigates to `/groups/:gid/settings`; on `/who` → navigates to `/me` |
| **⏻** SignOutIcon        | Account-level sign out (unchanged from v2.1)                                                              |

### 7.3 Hero card

Full-bleed: breaks out of the `max-w-2xl` content container via `width: 100vw; margin-left: calc(50% - 50vw)`. Height 320px on desktop, 220px on mobile. Backdrop priority chain:

1. IGDB screenshot URL: `https://images.igdb.com/igdb/image/upload/t_1080p/<igdb_screenshot_id>.jpg`
2. Steam header URL (`cover_url`) stretched
3. Solid `bg-panel` with game name centered

Dark gradient overlay at the bottom (`linear-gradient(to top, #0b0e14 0%, transparent 60%)`) ensures legibility regardless of backdrop.

Pulls from `recommendations.picks[0]` — same source as the Recommended row. Hero IS the top recommendation rendered larger. No separate "featured" logic. Click backdrop or "Open details" → opens GameDetailModal. Tapping the row's `↻ refresh` re-fetches recommendations and the hero re-renders.

Mobile: backdrop shorter (220px), description truncates to ~60 chars, thumbs stack below metadata.

### 7.4 Themed rows backed by `?preset=` on the library route

Five of the six rows hit a single new query parameter on the existing library route:

| Row                 | API                                                        |
| ------------------- | ---------------------------------------------------------- |
| Recommended tonight | `GET /api/groups/:gid/recommendations` (existing v2.1)     |
| Most-owned          | `GET /api/groups/:gid/library?preset=most-owned&limit=10`  |
| Co-op classics      | `GET /api/groups/:gid/library?preset=co-op&limit=10`       |
| PvP tonight         | `GET /api/groups/:gid/library?preset=pvp&limit=10`         |
| Recently played     | `GET /api/groups/:gid/library?preset=recent&limit=10`      |
| Hidden gems         | `GET /api/groups/:gid/library?preset=hidden-gems&limit=10` |

Six API calls fire in parallel on `/groups/:gid` mount. Each row independently renders when its data lands. Loading state per row.

Preset → SQL mapping (added to `routes/library.ts`):

| Preset        | WHERE clause                                               | ORDER BY                                          |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| `most-owned`  | (none)                                                     | `ownerCount DESC, name ASC`                       |
| `co-op`       | `has_coop = 1`                                             | `ownerCount DESC, steam_review_pct_positive DESC` |
| `pvp`         | `has_pvp = 1`                                              | `ownerCount DESC, steam_review_pct_positive DESC` |
| `recent`      | (none)                                                     | `maxLastPlayed DESC NULLS LAST`                   |
| `hidden-gems` | `steam_review_pct_positive >= 75 AND totalPlaytime <= 600` | `steam_review_pct_positive DESC`                  |

`totalPlaytime` is `SUM(playtime_minutes) GROUP BY game_id` across the group. The 600-minute (10-hour) threshold for hidden-gems is heuristic; tunable via `WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD` env var (default `"600"`).

Empty rows are hidden — no "no games match" placeholder. Page only shows rows with content. Avoids visual noise on small libraries.

### 7.5 GameCard variants

`GameCard.tsx` extends with optional `compact` prop (default `false`):

- **Compact** (rows): smaller (`w-full` inside `w-48 shrink-0` row container), tighter spacing, smaller text, all the same data
- **Default** (search overlay grid): current shape from v2.1

Both render thumbs, owned-by badge, rating. Both clickable → opens GameDetailModal.

### 7.6 GameDetailModal

```
┌──────────────────────────────────────────┐
│ [Cover image — Steam header, large]      │
│                                          │
│ Game Name                          [×]   │
│ Very Positive · 12k reviews              │
│ [Action] [Co-op] [Survival]              │
│                                          │
│ Description from IGDB summary, ~2-3      │
│ sentences of context.                    │
│                                          │
│ Owned by 6/8                             │
│ [👤 Alec] [👤 Mike] [👤 Sara] [👤 Ben]   │
│ [👤 Tim] [👤 Carol]                      │
│                                          │
│ Your playtime: 47h    Last played 3d ago │
│                                          │
│ [👍 4]  [👎 1]                           │
│                                          │
│ [Open on Steam ↗]                        │
└──────────────────────────────────────────┘
```

State managed via React (no URL push). Open: `setOpenGameId(gameId)`. Close: ESC, X button, click outside backdrop, or back-button (history.replaceState handles cleanly).

Mobile: full-screen overlay. Desktop: centered modal with backdrop overlay.

Body scroll locks while open.

Endpoint: `GET /api/games/:gameId?groupId=:gid`. Returns full game + group context.

```ts
{
  game: GameV22,                     // all fields including IGDB
  groupContext: {
    ownerCount: number,
    groupSize: number,
    members: Array<{                 // who owns it, with avatars + per-user playtime
      userId: string,
      displayName: string,
      avatarUrl: string | null,
      playtime: number,
      lastPlayed: string | null,
    }>,
    yourVote: -1 | 0 | 1,
    thumbs: { up: number, down: number },
    yourPlaytime: number | null,
    yourLastPlayed: string | null,
  }
}
```

Auth: session, member-of-group. Returns 403 for non-members, 404 if game not in any group member's library.

### 7.7 SearchOverlay

```
┌─────────────────────────────────────────────────────────┐
│ [🔍 Search by name...]                          [×]     │
│ [All] [Co-op] [PvP] [Single]                            │
├─────────────────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                             │
│ │card│ │card│ │card│ │card│   ← grid (2/3/4 cols)       │
│ └────┘ └────┘ └────┘ └────┘                             │
│ [Load more (N remaining)]                               │
└─────────────────────────────────────────────────────────┘
```

**Default state (empty query):** shows all games, paginated, current filter chip applied. Same behavior as the v2.1 "Browse library" section, relocated into an overlay.

**Live search:** typing debounces (~250ms) and re-fetches `/api/groups/:gid/library?q=<input>`. Filter chips compose with search query.

**Close:** X button, ESC key, click on backdrop outside the panel. Body scroll locks while open.

**Backend:** unchanged — overlay hits the existing `GET /api/groups/:gid/library` route with `limit/offset/filter/q` params already built in v2.1. No new endpoint.

**AbortController:** in-flight library fetches are cancelled when the user types again or closes the overlay. Prevents stale results from racing.

Cards inside the overlay open the same GameDetailModal — modal layers on top of the overlay. Closing modal returns to overlay (preserves search state). Closing overlay returns to group page.

### 7.8 Group settings page (`/groups/:gid/settings`)

```
← Group Name                                   [⏻]
─────────────────────────────────────────────────
Group Settings

Members
  [avatar] Alec     · creator
  [avatar] Mike     · member
  [avatar] Sara     · member
  ...

Active invite codes (creator only)
  https://whatweplayin.gg/invite/abc12345  [Copy]
  Uses 2/∞ · Expires Mon Jun 1
  [+ New invite]

─────────────────────────────────────────────────
Danger zone
  [Leave group]      ← regular members
  [Delete group]     ← creator only
─────────────────────────────────────────────────
```

Component: `apps/site/src/components/GroupSettings.tsx`. Page: `apps/site/src/pages/groups/[gid]/settings.astro`. Reuses existing `/api/groups/:gid` data; no new worker route.

Back arrow returns to `/groups/:gid`. Sign-out icon in top-right (account-level).

### 7.9 Mobile gestures

- Rows scroll horizontally with native `overflow-x-auto` + touch
- Cards inside rows have `min-w-[12rem]` so they don't shrink below readable size
- CSS `scroll-snap-type: x mandatory` + `scroll-snap-align: start` per card so flicks land cleanly
- Modal goes full-screen on mobile (< 640px)
- Hero compresses: backdrop shorter (220px), description truncates to ~60 chars, thumbs stack below metadata row
- SearchOverlay full-screen on mobile (input gets autoFocus on open)

## 8. Worker routes (new + modified)

### 8.1 New: `GET /api/games/:gameId?groupId=:gid`

Returns full game + per-group context for the modal. Auth: session, group member. Implementation in `apps/worker/src/routes/games.ts`.

Response shape (per Section 7.6).

Failure paths:

- 401 if not authenticated
- 403 if not a member of the requested group
- 404 if game doesn't exist OR isn't in any group member's ownership

### 8.2 Modified: `GET /api/groups/:gid/library?preset=<row-id>`

Adds `preset` query param accepting one of: `most-owned`, `co-op`, `pvp`, `recent`, `hidden-gems`. When provided, overrides `sort` and adds preset-specific WHERE clauses. `filter`, `q`, `limit`, `offset` continue to work alongside (e.g., `?preset=co-op&q=valh&limit=5`).

Default `limit` for preset queries: 10 (small enough to render 5-7 visible cards in the row with side-scroll headroom).

### 8.3 Unchanged routes still in v2.2 path

- `GET /api/groups/:gid/recommendations` — drives top row + hero (no API shape change)
- `PUT /api/groups/:gid/games/:gameId/thumb` — drives thumbs voting from cards, hero, and modal
- `DELETE /api/groups/:gid/games/:gameId/thumb` — same
- `POST /api/me/sync/steam` — IGDB enrichment now folds into the existing pipeline
- `POST /api/me/enrich-more` — auto-loop endpoint, unchanged shape
- `GET /api/config` — returns the same flag set; new flags (`igdb`, `groupFit`) are not surfaced to site (purely internal)

## 9. Feature flags

### 9.1 New v2.2 flags in `apps/worker/wrangler.toml [vars]`

```toml
WWP_FEAT_IGDB = "true"
WWP_WEIGHT_GROUPFIT = "0.2"
WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD = "600"  # minutes; max playtime for hidden-gems preset
```

### 9.2 Tunable changes

```toml
WWP_WEIGHT_THUMBS = "0.4"            # was 0.5
WWP_WEIGHT_OWNERSHIP = "0.2"         # was 0.3
WWP_WEIGHT_NOVELTY = "0.2"           # unchanged
WWP_ENRICHMENT_MAX_PER_RUN = "13"    # was 20
```

### 9.3 `Env` interface additions in `apps/worker/src/index.ts`

```ts
export interface Env {
  // ... existing
  IGDB_CLIENT_ID: string; // already declared in v2.0; now actually used
  IGDB_CLIENT_SECRET: string; // same
  WWP_FEAT_IGDB?: string;
  WWP_WEIGHT_GROUPFIT?: string;
  WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD?: string;
}
```

### 9.4 `docs/feature-flags.md` updates

New rows for `WWP_FEAT_IGDB`, `WWP_WEIGHT_GROUPFIT`, `WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD`. Update existing rows for the rebalanced weight defaults and the new `WWP_ENRICHMENT_MAX_PER_RUN` value.

### 9.5 Netflix UI is _not_ feature-flagged

Wholesale layout replacement. Rollback = `git revert`. Avoids maintaining two parallel UI branches.

## 10. Edge cases (explicit handling)

| Case                                               | Behavior                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game not in IGDB                                   | `description`, `genres`, `igdb_screenshot_id`, `optimal_min`/`optimal_max` stay NULL. UI degrades gracefully. Recommender's `groupFit` returns 0.5 neutral.                                                                                |
| IGDB Twitch token refresh fails                    | Skip IGDB step entirely for this run; Steam enrichment still completes. Logs warning. Next run retries.                                                                                                                                    |
| IGDB rate limit (429)                              | Mark as transient skip; game stays un-enriched; auto-loop catches it next round.                                                                                                                                                           |
| `WWP_FEAT_IGDB="false"`                            | enrichOne behaves like v2.1 sync (Steam-only). Catalog still populates. UI degrades to v2.1-style cards (no descriptions, no genre pills).                                                                                                 |
| Group with no library yet                          | Hero hidden; rows hidden (empty preset queries); SearchOverlay shows "no games match." Page header still shows. Settings cog still accessible.                                                                                             |
| Solo group (creator alone)                         | All rows render. groupFit filter relaxes (single-player not auto-excluded). Recommender still ranks.                                                                                                                                       |
| Backdrop image fails to load (404, network)        | Graceful chain: IGDB screenshot URL → Steam header URL → solid `bg-panel` color. Game name always renders.                                                                                                                                 |
| Modal opened on game user can't access (403)       | Modal renders error state; shows close button; does not redirect.                                                                                                                                                                          |
| SearchOverlay closed mid-query                     | AbortController cancels in-flight library fetch; modal closes cleanly.                                                                                                                                                                     |
| Mobile horizontal scroll on a row                  | CSS `scroll-snap-type: x mandatory` snaps cards into place; works with native touch.                                                                                                                                                       |
| Rapid filter chip switching in SearchOverlay       | Debounce (250ms) + AbortController prevent stale fetches from racing.                                                                                                                                                                      |
| User opens modal then navigates away               | Modal state cleared on route change; re-fetched fresh next open.                                                                                                                                                                           |
| All themed rows return empty                       | Page shows hero (if recommendations have content) and hides every row. Hero may also be empty for a totally fresh group; in that case page is just header + a "link Steam to populate" prompt (degrades from v2.1's existing empty state). |
| User is on `/groups/:gid` while another user joins | Member count updates only on next page load. Real-time presence is out of scope; 30s of staleness is acceptable for friend-group scale.                                                                                                    |

## 11. Testing strategy

### 11.1 New / extended tests

| File                                                    | Scope                                                                        | New tests |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| `apps/worker/tests/igdb-api.test.ts` (new)              | Twitch token cache + IGDB games-endpoint                                     | ~6        |
| `apps/worker/tests/steam-sync.test.ts` (extend)         | IGDB enrichment integration into enrichOne                                   | ~3        |
| `apps/worker/tests/library-routes.test.ts` (extend)     | preset query param for each of the 5 rows                                    | ~5        |
| `apps/worker/tests/games-route.test.ts` (new)           | GET /api/games/:gameId — happy/401/403/404                                   | ~4        |
| `packages/recommender/tests/v2-thumbs.test.ts` (extend) | computeGroupFitScore + rankByThumbs integration with new factor + regression | ~6        |

**Total new tests: ~24.** Brings worker from ~133 → ~150 and recommender from ~83 → ~89.

### 11.2 Site testing

E2E (Playwright) deferred to a future release. Site verification continues:

- `pnpm --filter @wwp/site build` — clean
- `pnpm --filter @wwp/site typecheck` — clean
- Manual smoke after deploy: visit `/groups/<id>`, confirm hero renders with IGDB backdrop, click card → modal opens with description + member list, click search → overlay opens with filter chips, click cog → group settings page renders with members list

### 11.3 Existing tests

All 133 v2.1 worker tests must continue to pass. Recommender tests likewise. Any failure = regression, not migration.

## 12. Migration & rollout

### 12.1 Forward path

1. PR merges to `main`. CI runs lint + typecheck + 156 worker tests + 89 recommender tests + site build.
2. `deploy-worker` job:
   - Pushes secrets (now including `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`)
   - Applies migration `0006_v22_igdb_metadata.sql` to remote D1
   - Deploys worker code
3. Pages auto-rebuilds with new UI components and the route changes.
4. First user visits `/me` → autosync triggers → IGDB enrichment begins on un-enriched games. Auto-loop populates ~13 games per round; ~250-game catalog completes in ~60s.
5. Group page with the new layout works immediately for users whose Steam metadata is already populated; IGDB metadata layers on as enrichment progresses (hero gradually gets a backdrop instead of falling back to Steam header).

### 12.2 Rollback paths

1. **IGDB destabilizes** (Twitch outage, API changes, runaway costs): flip `WWP_FEAT_IGDB="false"` in `wrangler.toml` → push → ~30s redeploy. Sync continues Steam-only. UI degrades to v2.2-shape with no description/genre pills, but page still works.
2. **Netflix UI breaks visibly** in production: `git revert <PR-SHA>` → push → redeploy. v2.1 UI returns. Migration 0006 stays applied (additive; safe). IGDB-enriched columns persist in D1; if IGDB stays enabled, future runs continue enriching, just with no UI consuming the new fields until v2.2 is re-tried.

### 12.3 Schema additivity

Migration 0006 only adds columns and a new table. No drops, no renames, no destructive changes. Rolling back the worker code while keeping the schema is safe; new columns become unused but not corrupted.

## 13. Risks

### 13.1 IGDB API stability and rate limits

Third-party dependency on Twitch + IGDB. Mitigated by `WWP_FEAT_IGDB` flag + graceful per-game skip behavior. Worst case: descriptions / genres / hero backdrops never populate, but Steam-only data still flows.

### 13.2 Twitch OAuth token edge cases

D1-cached singleton pattern handles normal lifecycle. Race condition on simultaneous expiry: both requests refresh; both write the same token; harmless. Truly invalid credentials: every IGDB call fails on first token attempt; logs surface the issue; no impact to Steam enrichment.

### 13.3 Mobile horizontal-scroll UX

Untested on real device until manual smoke. Risks: cards too small, touch flicks not snapping, rows scrolling jankily on iOS Safari. Mitigation: ship a v2.2.1 polish release if smoke testing reveals issues. Specific things to watch:

- Card minimum width on small viewports
- Scroll-snap behavior on iOS Safari (historically buggier than Android Chrome)
- Vertical-scroll lock during horizontal-scroll (so the row doesn't "drift" the page upward)

### 13.4 Background enrichment time

3 calls per game (vs 2 in v2.1) and a smaller `MAX_PER_RUN` (13 vs 20). A 250-game library now takes ~60s of auto-loop instead of ~30s. Acceptable for a one-time onboarding cost but worth surfacing in the progress UI ("Enriching metadata: 187 of 250" — same UX as v2.1).

### 13.5 Hero backdrop loading

Full-bleed hero is the most visually impactful element. If the IGDB image is slow or 404s, user sees a flash of nothing or a clearly-broken image. Mitigation:

- Skeleton state during load (`bg-panel` placeholder until image resolves)
- Steam-header fallback on error
- Backdrop URL preloaded on page mount (parallel to API fetches) so it's cached by the time the hero renders

### 13.6 IGDB derivation accuracy

The optimal-player-count derivation is heuristic. Some games will land in the wrong tier (e.g., an MMO with `online_max=200` looks like it wants 100+ players, but we cap at... actually we don't cap). For v2.2 we accept some noise; v2.3+ can introduce a curated catalog tier override (`catalog_tier='curated'` already in schema, unused).

### 13.7 IGDB Terms of Service

IGDB's TOS requires attribution: "Powered by IGDB.com". Plan to add a small "Game data from IGDB and Steam" footer in the SearchOverlay or Modal. Not user-facing critical-path; can add as v2.2.1 polish if missed in initial implementation.

## 14. Roadmap context

| Version  | Status        | Scope                                                                                                                                                             |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.0     | shipped       | Auth, groups, invites, sessions, /me settings                                                                                                                     |
| v2.1     | shipped       | Steam library sync, lightweight recommender, thumbs voting, minimal UI                                                                                            |
| **v2.2** | **this spec** | **Netflix UI rebuild, IGDB enrichment, groupFit recommender factor, group settings page**                                                                         |
| v2.3+    | TBD           | Filter enhancements (#28), screenshot gallery in modal, stable preference sliders, cron-based catalog refresh, profile dropdown, session log, non-Steam libraries |
