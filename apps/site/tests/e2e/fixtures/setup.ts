import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root (5 levels up from apps/site/tests/e2e/fixtures/setup.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const root = resolve(__dirname, '../../../../..');
const workerDir = resolve(root, 'apps/worker');

export const GROUP_ID = 'e2etest';
// Plaintext secret stored in local KV; matched by the test's localStorage seed
export const DEV_SECRET = 'devsecret';

/** Path to the Astro public data directory that is served verbatim in dev. */
const publicGroupDir = resolve(root, 'apps/site/public/data/groups', GROUP_ID);

function writeGroupFiles(): void {
  mkdirSync(publicGroupDir, { recursive: true });

  const people = [
    { id: 'alec',  displayName: 'alec',  stablePrefs: { combat: 3, grind: 3, buildingDepth: 3, commitmentLevel: 3, pvpFocus: 3, sessionLength: 3 } },
    { id: 'mike',  displayName: 'mike',  stablePrefs: { combat: 3, grind: 3, buildingDepth: 3, commitmentLevel: 3, pvpFocus: 3, sessionLength: 3 } },
    { id: 'sarah', displayName: 'sarah', stablePrefs: { combat: 3, grind: 3, buildingDepth: 3, commitmentLevel: 3, pvpFocus: 3, sessionLength: 3 } },
  ];

  const group = {
    id: GROUP_ID,
    displayName: 'E2E',
    scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
    // secretHash is unused by the worker (it checks plaintext KV directly); included for shape parity
    secretHash: 'e2e-placeholder',
  };

  writeFileSync(resolve(publicGroupDir, 'people.json'), JSON.stringify(people, null, 2));
  writeFileSync(resolve(publicGroupDir, 'group.json'), JSON.stringify(group, null, 2));
}

/** Game every attendee owns so the filter always passes for the E2E run. */
export const SEEDED_GAME_ID = 'runescape-dragonwilds';
const PEOPLE = ['alec', 'mike', 'sarah'];

/**
 * Seed the wrangler local KV (--persist-to .wrangler/state-test) with:
 *   - group secret (auth)
 *   - ownership records for SEEDED_GAME_ID (so the recommender returns picks)
 */
function seedWorkerKv(): void {
  const wranglerBin = resolve(workerDir, 'node_modules/.bin/wrangler');
  const base = `"${wranglerBin}" kv key put --namespace-id PLACEHOLDER_REPLACE_ON_DEPLOY --local --persist-to .wrangler/state-test`;
  const opts = { cwd: workerDir, stdio: 'inherit' as const };

  // Auth secret
  execSync(`${base} "group:${GROUP_ID}:secret" "${DEV_SECRET}"`, opts);

  // Ownership: each person owns the seeded game
  for (const person of PEOPLE) {
    execSync(
      `${base} "group:${GROUP_ID}:person:${person}:owns:${SEEDED_GAME_ID}" "true"`,
      opts,
    );
  }
}

export function setupFixture(): void {
  if (existsSync(publicGroupDir)) {
    rmSync(publicGroupDir, { recursive: true, force: true });
  }
  writeGroupFiles();
  seedWorkerKv();
  console.log(`[e2e setup] group "${GROUP_ID}" written to public/data and KV seeded`);
}

export function teardownFixture(): void {
  if (existsSync(publicGroupDir)) {
    rmSync(publicGroupDir, { recursive: true, force: true });
  }
  console.log(`[e2e teardown] group "${GROUP_ID}" removed from public/data`);
}
