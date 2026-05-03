import { test, expect, describe } from 'vitest';
import { groupFit } from '../src/group-fit.js';
import type { Game, Person } from '../src/types.js';

const game = (optMin: number, optMax: number, min = 1, max = 10): Game => ({
  id: 'g',
  name: 'g',
  minPlayers: min,
  maxPlayers: max,
  optimalPlayers: { min: optMin, max: optMax },
  hostingModel: 'p2p',
  releaseStatus: 'released',
  hasSinglePlayer: true,
  hasCoop: true,
  hasPvP: false,
  genre: ['survival'],
});

const attendees = (n: number): Person[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    displayName: `p${i}`,
    stablePrefs: {
      combat: 3,
      grind: 3,
      buildingDepth: 3,
      commitmentLevel: 3,
      pvpFocus: 3,
      sessionLength: 3,
    },
  }));

describe('groupFit', () => {
  test('1.0 when count is in optimal range', () => {
    expect(groupFit(game(2, 5), attendees(3))).toBe(1.0);
    expect(groupFit(game(2, 5), attendees(2))).toBe(1.0);
    expect(groupFit(game(2, 5), attendees(5))).toBe(1.0);
  });

  test('0.8 when count is 1 below optimal min', () => {
    expect(groupFit(game(3, 5), attendees(2))).toBeCloseTo(0.8);
  });

  test('0.6 when count is 2 above optimal max', () => {
    expect(groupFit(game(2, 4), attendees(6))).toBeCloseTo(0.6);
  });

  test('floors at 0.4 even at large distance', () => {
    expect(groupFit(game(2, 4, 1, 20), attendees(20))).toBe(0.4);
  });
});
