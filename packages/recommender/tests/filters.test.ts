import { test, expect, describe } from 'vitest';
import { passesFilter, explainExclusion } from '../src/filters.js';
import type { Game, Person, OwnsLookup } from '../src/types.js';

const game = (over: Partial<Game> = {}): Game => ({
  id: 'valheim',
  name: 'Valheim',
  minPlayers: 1,
  maxPlayers: 10,
  optimalPlayers: { min: 2, max: 5 },
  hostingModel: 'p2p',
  releaseStatus: 'released',
  hasSinglePlayer: true,
  hasCoop: true,
  hasPvP: true,
  genre: ['survival'],
  ...over,
});

const person = (id: string): Person => ({
  id,
  displayName: id,
  stablePrefs: { combat: 3, grind: 3, buildingDepth: 3, commitmentLevel: 3, pvpFocus: 3, sessionLength: 3 },
});

const owns = (entries: Record<string, string[]>): OwnsLookup => {
  const out: OwnsLookup = {};
  for (const [pid, gameIds] of Object.entries(entries)) {
    out[pid] = {};
    for (const gid of gameIds) out[pid][gid] = true;
  }
  return out;
};

describe('passesFilter', () => {
  test('passes when attendees within range and all own', () => {
    const g = game({ minPlayers: 1, maxPlayers: 4 });
    const a = [person('alec'), person('mike')];
    expect(passesFilter(g, a, owns({ alec: ['valheim'], mike: ['valheim'] }))).toBe(true);
  });

  test('fails when attendee count below minPlayers', () => {
    const g = game({ minPlayers: 4, maxPlayers: 10 });
    const a = [person('alec'), person('mike')];
    expect(passesFilter(g, a, owns({ alec: ['valheim'], mike: ['valheim'] }))).toBe(false);
  });

  test('fails when attendee count above maxPlayers', () => {
    const g = game({ minPlayers: 1, maxPlayers: 2 });
    const a = [person('alec'), person('mike'), person('sarah')];
    expect(passesFilter(g, a, owns({ alec: ['valheim'], mike: ['valheim'], sarah: ['valheim'] }))).toBe(false);
  });

  test('fails when one attendee does not own the game', () => {
    const g = game();
    const a = [person('alec'), person('mike')];
    expect(passesFilter(g, a, owns({ alec: ['valheim'] }))).toBe(false);
  });

  test('fails when owns lookup is empty', () => {
    const g = game();
    const a = [person('alec')];
    expect(passesFilter(g, a, {})).toBe(false);
  });
});

describe('explainExclusion', () => {
  test('explains player count below min', () => {
    const g = game({ minPlayers: 4, maxPlayers: 10 });
    const a = [person('alec')];
    expect(explainExclusion(g, a, owns({ alec: ['valheim'] }))).toMatch(/needs 4-10 players, you have 1/);
  });

  test('explains missing owners by name', () => {
    const g = game();
    const a = [person('alec'), person('mike')];
    expect(explainExclusion(g, a, owns({ alec: ['valheim'] }))).toMatch(/mike doesn't own/i);
  });
});
