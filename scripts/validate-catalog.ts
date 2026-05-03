#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGame } from './lib/validate-game.js';

const catalogPath = resolve(process.cwd(), 'data/games.json');

let raw: string;
try {
  raw = readFileSync(catalogPath, 'utf8');
} catch (err) {
  console.error(`error: cannot read ${catalogPath}: ${(err as Error).message}`);
  process.exit(1);
}

let games: unknown;
try {
  games = JSON.parse(raw);
} catch (err) {
  console.error(`error: ${catalogPath} is not valid JSON: ${(err as Error).message}`);
  process.exit(1);
}

if (!Array.isArray(games)) {
  console.error('error: top-level value of games.json must be an array');
  process.exit(1);
}

const ids = new Set<string>();
let totalErrors = 0;

games.forEach((game, idx) => {
  const result = validateGame(game);
  const id = (game as { id?: string }).id ?? `<index ${idx}>`;
  if (typeof (game as { id?: string }).id === 'string') {
    if (ids.has((game as { id: string }).id)) {
      console.error(`[${id}] duplicate id`);
      totalErrors++;
    }
    ids.add((game as { id: string }).id);
  }
  if (result.errors.length > 0) {
    console.error(`[${id}] ${result.errors.length} error(s):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    totalErrors += result.errors.length;
  }
});

if (totalErrors > 0) {
  console.error(`\nFAIL: ${totalErrors} validation error(s) across ${games.length} games.`);
  process.exit(1);
}

console.log(`OK: ${games.length} games validated.`);
