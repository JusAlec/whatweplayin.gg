# Feature Flags

WhatWePlayin gates behavior behind feature flags read from `apps/worker/wrangler.toml [vars]`. Flags are typed via the `Env` interface in `apps/worker/src/index.ts` and read through helpers in `apps/worker/src/lib/flags.ts`.

## Flag conventions

- **Behavior toggles for routes** (`WWP_FEAT_THUMBS`, `WWP_FEAT_RECOMMENDATIONS`): use `flagOff(env, key)`. Returns `true` only for the literal string `"false"`. Default = enabled (test-time-safe).
- **Behavior triggers** (`WWP_FEAT_AUTOSYNC_ON_LOGIN`, `WWP_FEAT_STEAM_RATINGS`): use `flagOn(env, key)`. Returns `true` only for the literal string `"true"`. Default = disabled (test-time-safe — autosync doesn't fire unexpectedly in tests).
- **Tunables** (`WWP_<NAME>`): use `readNumber(env, key, fallback)`. Returns the parsed number or the fallback if unset/empty/non-numeric.

## Flipping a flag

1. Edit `apps/worker/wrangler.toml`.
2. Commit + push to `v2-foundation` (or main).
3. Auto-deploy via `deploy-worker` GitHub Action picks up the new value within ~30 seconds.
4. New worker requests use the new value immediately. Site reads boolean flags from `GET /api/config`; client refetches on next page load.

## v2.1 flags

| Flag                           | Type   | Default  | Helper       | When ON / set                                                                                                                   | When OFF / unset                                                  | Notes                                                                            |
| ------------------------------ | ------ | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `WWP_FEAT_AUTOSYNC_ON_LOGIN`   | bool   | `"true"` | `flagOn`     | `/api/me` triggers `ctx.waitUntil(syncSteamLibrary)` when the user's Steam library is older than `WWP_AUTOSYNC_STALENESS_HOURS` | autosync disabled; only initial-on-link and manual refresh remain | Flip to `"false"` if Steam Web API rate limits become a concern                  |
| `WWP_FEAT_THUMBS`              | bool   | `"true"` | `flagOff`    | thumbs voting routes accept PUT/DELETE; UI renders thumbs buttons on cards                                                      | thumbs routes return 503; UI hides thumbs buttons                 | Disabling doesn't delete existing votes — they're inert until re-enabled         |
| `WWP_FEAT_RECOMMENDATIONS`     | bool   | `"true"` | `flagOff`    | `/api/groups/:gid/recommendations` returns ranked picks                                                                         | route returns 503; UI hides "Recommended tonight" section         | Library section still works — recommendations are an additive layer              |
| `WWP_FEAT_STEAM_RATINGS`       | bool   | `"true"` | `flagOn`     | recommender uses cold-start blend with Steam % positive; UI shows "Very Positive · 12k reviews" badge on cards                  | cold-start blend disabled; rating badge hidden                    | Falls back to base thumbs score during cold-start (less guidance for new groups) |
| `WWP_AUTOSYNC_STALENESS_HOURS` | number | `"6"`    | `readNumber` | hours; if `users.steam_library_synced_at` is older than this, autosync fires                                                    | (n/a — tunable)                                                   | Lower = fresher data, more API calls. Higher = staler, fewer calls.              |
| `WWP_WEIGHT_THUMBS`            | number | `"0.4"`  | `readNumber` | recommender weight on the thumbs axis                                                                                           | (n/a)                                                             | Weights need not sum to 1.0 but should for sanity                                |
| `WWP_WEIGHT_OWNERSHIP`         | number | `"0.2"`  | `readNumber` | recommender weight on the ownership-prevalence axis                                                                             | (n/a)                                                             |                                                                                  |
| `WWP_WEIGHT_NOVELTY`           | number | `"0.2"`  | `readNumber` | recommender weight on the novelty (recency-decay) axis                                                                          | (n/a)                                                             |                                                                                  |
| `WWP_RECOMMENDATIONS_LIMIT`    | number | `"5"`    | `readNumber` | how many picks the recommender returns                                                                                          | (n/a)                                                             | UI's "Recommended tonight" row scrolls horizontally if > 5                       |
| `WWP_THUMBS_DOWN_VETO_DAYS`    | number | `"7"`    | `readNumber` | days a thumb-down filters a game out of recommendations for the group                                                           | (n/a)                                                             | After veto expires, the game can return to the candidate pool                    |
| `WWP_ENRICHMENT_MAX_PER_RUN`   | number | `"13"`   | `readNumber` | max games enrichOne processes per sync run (Steam Store + IGDB)                                                                  | (n/a)                                                             | Lower = slower sync, fresher data. Higher = faster but risks rate-limiting.      |

## v2.2 flags

| Flag | Type | Default | Helper | When ON / set | When OFF / unset | Notes |
|---|---|---|---|---|---|---|
| `WWP_FEAT_IGDB` | bool | `"true"` | `flagOn` | enrichOne calls IGDB games endpoint after Steam Store; populates description/genres/igdb_screenshot_id/optimal_min/max | IGDB step skipped; sync stays Steam-only | Flip to `"false"` if IGDB has an outage |
| `WWP_WEIGHT_GROUPFIT` | number | `"0.2"` | `readNumber` | recommender weight on the groupFit axis (player-count-fit) | (n/a) | Defaults sum to 1.0 with rebalanced thumbs/ownership |
| `WWP_HIDDEN_GEMS_PLAYTIME_THRESHOLD` | number | `"600"` | `readNumber` | playtime ceiling (minutes) for the hidden-gems library preset; games with total group playtime ≤ this AND review pct ≥ 75 qualify | (n/a) | Increase if hidden-gems row is sparse |

## Adding a new flag

1. Add to the `Env` interface in `apps/worker/src/index.ts`.
2. Add to the `[vars]` block in `apps/worker/wrangler.toml` with its default value as a string.
3. Decide semantics: behavior trigger (`flagOn` — opt-in) vs route toggle (`flagOff` — opt-out). Behavior triggers are safer for tests since unset = off.
4. If the flag should affect site UI: add to `GET /api/config` response in `apps/worker/src/routes/config.ts` AND to the `FeatureFlags` interface in `packages/auth-shared/src/types.ts`.
5. Append a row to the table above with `name`, `type`, `default`, `helper`, `when on`, `when off`, `notes`.
6. Reference the flag in the code path it gates with `flagOn` / `flagOff` / `readNumber`.

PR-required to add or remove flags. Don't introduce a flag that isn't documented here.

## Auto-disable on failure

Out of scope for v2.1. If a flagged route hits sustained errors, log loudly. Operator manually flips the flag after observing logs. Self-healing is a v3+ concern.
