# GameNight OS

Decide which survival game to play tonight, fast.

## Stack
Astro + React + Tailwind | Cloudflare Workers + KV + Pages | pnpm workspaces

## Setup
```
nvm use
corepack enable
pnpm install
pnpm dev          # site at http://localhost:4321
pnpm test         # all tests
pnpm validate:catalog  # validates data/games.json
```

See `docs/specs/` and `docs/plans/` for design and implementation docs.
