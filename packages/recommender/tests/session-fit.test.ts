import { test, expect, describe } from 'vitest';
import { sessionFit, SESSION_LENGTH_MINS } from '../src/session-fit.js';
import type { Game, RatingCache } from '../src/types.js';

const game: Game = {
  id: 'g',
  name: 'g',
  minPlayers: 1,
  maxPlayers: 4,
  optimalPlayers: { min: 1, max: 4 },
  hostingModel: 'p2p',
  releaseStatus: 'released',
  hasSinglePlayer: true,
  hasCoop: true,
  hasPvP: false,
  genre: ['survival'],
};

const cacheFor = (sessionLength: number): RatingCache => ({
  combat: { avg: 3, variance: 0, n: 5 },
  grind: { avg: 3, variance: 0, n: 5 },
  buildingDepth: { avg: 3, variance: 0, n: 5 },
  commitmentLevel: { avg: 3, variance: 0, n: 5 },
  pvpFocus: { avg: 3, variance: 0, n: 5 },
  sessionLength: { avg: sessionLength, variance: 0, n: 5 },
});

describe('sessionFit', () => {
  test('returns 0.8 when timeAvailableMins is null', () => {
    expect(sessionFit(game, null, { g: cacheFor(3) }, {})).toBe(0.8);
  });

  test('1.0 when time exceeds required mins', () => {
    expect(sessionFit(game, 200, { g: cacheFor(3) }, {})).toBe(1.0);
  });

  test('exact match scores 1.0', () => {
    expect(sessionFit(game, SESSION_LENGTH_MINS[3]!, { g: cacheFor(3) }, {})).toBe(1.0);
  });

  test('partial penalty when time is less than required', () => {
    expect(sessionFit(game, 120, { g: cacheFor(4) }, {})).toBe(0.5);
  });

  test('rounds non-integer rating value', () => {
    expect(sessionFit(game, 60, { g: cacheFor(2.6) }, {})).toBeCloseTo(0.5);
  });
});
