import { test, expect, describe } from 'vitest';
import { dimMatch, preferenceMatch } from '../src/preference-match.js';
import type { Game, Person, RatingCache, StablePrefs } from '../src/types.js';

const ALL = (n: number): StablePrefs => ({
  combat: n,
  grind: n,
  buildingDepth: n,
  commitmentLevel: n,
  pvpFocus: n,
  sessionLength: n,
});

const game: Game = {
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
};

const allRated = (avg: number): RatingCache => ({
  combat: { avg, variance: 0, n: 5 },
  grind: { avg, variance: 0, n: 5 },
  buildingDepth: { avg, variance: 0, n: 5 },
  commitmentLevel: { avg, variance: 0, n: 5 },
  pvpFocus: { avg, variance: 0, n: 5 },
  sessionLength: { avg, variance: 0, n: 5 },
});

const person = (prefs: StablePrefs, id = 'alec', weight?: number): Person => ({
  id,
  displayName: id,
  stablePrefs: prefs,
  weight,
});

describe('dimMatch', () => {
  test('exact match scores 1.0', () => {
    expect(dimMatch(3, 3)).toBe(1.0);
  });

  test('max distance scores 0.0', () => {
    expect(dimMatch(1, 5)).toBe(0.0);
    expect(dimMatch(5, 1)).toBe(0.0);
  });

  test('off by 2 scores 0.5', () => {
    expect(dimMatch(2, 4)).toBe(0.5);
  });
});

describe('preferenceMatch', () => {
  test('exact match across all dims for one attendee scores 1.0', () => {
    const cache = { valheim: allRated(3) };
    expect(preferenceMatch(game, [person(ALL(3))], cache, {})).toBe(1.0);
  });

  test('total mismatch across all dims scores 0.0', () => {
    const cache = { valheim: allRated(5) };
    expect(preferenceMatch(game, [person(ALL(1))], cache, {})).toBe(0.0);
  });

  test('weighted average across multiple attendees', () => {
    const cache = { valheim: allRated(3) };
    const attendees = [person(ALL(3), 'alec'), person(ALL(5), 'mike')];
    expect(preferenceMatch(game, attendees, cache, {})).toBeCloseTo(0.75);
  });

  test('attendee weight skews the average', () => {
    const cache = { valheim: allRated(3) };
    const attendees = [person(ALL(3), 'alec', 3), person(ALL(5), 'mike', 1)];
    expect(preferenceMatch(game, attendees, cache, {})).toBeCloseTo(0.875);
  });

  test('missing rating uses neutral default of 3', () => {
    const attendees = [person(ALL(3))];
    expect(preferenceMatch(game, attendees, {}, {})).toBe(1.0);
  });
});
