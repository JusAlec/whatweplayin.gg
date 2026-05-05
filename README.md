# WhatWePlayin

A friend-group game-night picker. Tells groups what to play tonight by combining each member's Steam library, group thumbs voting, IGDB metadata, and a recommender that scores games on owner overlap, novelty, and player-count fit.

Live at [whatweplayin.gg](https://whatweplayin.gg).

## Stack

- **Site:** [Astro 4](https://astro.build/) SSR via `@astrojs/cloudflare`, [React 18](https://react.dev/) islands, [Tailwind CSS](https://tailwindcss.com/)
- **Worker:** [Cloudflare Workers](https://developers.cloudflare.com/workers/) (TypeScript), [D1](https://developers.cloudflare.com/d1/) for storage, sessions in cookies
- **Auth:** Steam OpenID + magic-link email (Resend) + OAuth account linking
- **Recommender:** pure-function package at `packages/recommender/` (4 factors: thumbs, ownership, novelty, groupFit)
- **Tests:** [Vitest](https://vitest.dev/) for unit + worker (miniflare via `@cloudflare/vitest-pool-workers`); [Playwright](https://playwright.dev/) for site e2e
- **Build:** pnpm 9 workspaces; Node 22 (Wrangler v4 requires ≥22)

## Repo layout

```
apps/
  site/              Astro + React (whatweplayin.gg)
  worker/            Cloudflare Worker (api.whatweplayin.gg) + D1 migrations
packages/
  auth-shared/       Shared types & Zod schemas
  recommender/       Pure-function game-ranking logic
scripts/             One-off utilities (validate-catalog, bootstrap-group)
data/
  games.json         Curated catalog seed (validated by scripts/validate-catalog.ts)
docs/
  deploy.md          Deploy + bootstrap runbook
  feature-flags.md   All `WWP_*` flag/tunable env vars
  superpowers/       Specs and implementation plans (most recent first)
```

## Setup

```bash
nvm use                   # uses .nvmrc → Node 22
corepack enable           # pins pnpm@9.15.4 from package.json#packageManager
pnpm install
pnpm dev                  # site at http://localhost:4321 (Astro)
                          # worker dev: pnpm --filter @wwp/worker dev (port 8787)
```

## Common scripts (run from repo root)

| Script                  | What it does                                       |
| ----------------------- | -------------------------------------------------- |
| `pnpm dev`              | Astro dev server only. Worker dev runs separately. |
| `pnpm test`             | Recursive test across all packages                 |
| `pnpm test:unit`        | `@wwp/recommender` unit tests only                 |
| `pnpm test:worker`      | Worker tests in miniflare                          |
| `pnpm test:e2e`         | Playwright e2e against the site                    |
| `pnpm build`            | Recursive build (site + worker bundle)             |
| `pnpm typecheck`        | Recursive `tsc --noEmit` + `astro check`           |
| `pnpm lint`             | ESLint + Prettier check                            |
| `pnpm format`           | Prettier write                                     |
| `pnpm validate:catalog` | Schema-validates `data/games.json`                 |

Worker tests need `BETTER_AUTH_SECRET=test` in env, e.g.

```bash
BETTER_AUTH_SECRET=test pnpm test:worker
```

## Specs and plans

The current product was built in three phases. See:

- `docs/superpowers/specs/2026-04-19-whatweplayin-v2-0-design.md` — auth, groups, invites, /me settings (v2.0)
- `docs/superpowers/specs/2026-04-26-whatweplayin-v2-1-design.md` — Steam library sync, recommender, thumbs voting (v2.1)
- `docs/superpowers/specs/2026-05-04-whatweplayin-v2-2-design.md` — Netflix UI rebuild + IGDB enrichment + groupFit recommender (v2.2)

Each spec has a paired plan in `docs/superpowers/plans/`.

## Deploying

Auto-deploy on merge to `main` via `.github/workflows/test.yml` — pushes Worker secrets, applies D1 migrations to `whatweplayin-prod`, runs `wrangler deploy`. See [`docs/deploy.md`](docs/deploy.md) for the full runbook including initial bootstrap.

## License

Private — not currently open-source.
