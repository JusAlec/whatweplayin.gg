import { describe, test, expect } from 'vitest';
import {
  computeThumbsScore,
  computeOwnershipScore,
  computeNoveltyScore,
  computeGroupFitScore,
  rankByThumbs,
} from '../src/v2-thumbs.js';

describe('computeThumbsScore', () => {
  test('returns 0.5 (neutral) for game with no thumbs', () => {
    const score = computeThumbsScore({
      groupSize: 5,
      gameThumbs: [],
      totalGroupThumbs: 10,
      steamPctPositive: null,
    });
    expect(score).toBeCloseTo(0.5, 5);
  });

  test('returns 1.0 when every member thumbs up', () => {
    const score = computeThumbsScore({
      groupSize: 4,
      gameThumbs: [{ vote: 1 }, { vote: 1 }, { vote: 1 }, { vote: 1 }],
      totalGroupThumbs: 10,
      steamPctPositive: null,
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  test('returns 0.0 when every member thumbs down', () => {
    const score = computeThumbsScore({
      groupSize: 4,
      gameThumbs: [{ vote: -1 }, { vote: -1 }, { vote: -1 }, { vote: -1 }],
      totalGroupThumbs: 10,
      steamPctPositive: null,
    });
    expect(score).toBeCloseTo(0.0, 5);
  });

  test('returns 0.7 for 5-member group with 2 ups, 0 downs', () => {
    // sum=2, avg=2/5=0.4, base=(0.4+1)/2 = 0.7
    const score = computeThumbsScore({
      groupSize: 5,
      gameThumbs: [{ vote: 1 }, { vote: 1 }],
      totalGroupThumbs: 10,
      steamPctPositive: null,
    });
    expect(score).toBeCloseTo(0.7, 5);
  });

  test('blends with Steam rating in cold-start mode', () => {
    // Cold start (totalGroupThumbs < 5). No game thumbs. Steam rating 80%.
    // base = 0.5, blend = 0.5 * 0.5 + 0.5 * 0.8 = 0.65
    const score = computeThumbsScore({
      groupSize: 5,
      gameThumbs: [],
      totalGroupThumbs: 0,
      steamPctPositive: 80,
    });
    expect(score).toBeCloseTo(0.65, 5);
  });

  test('skips Steam blend in cold-start mode if rating data is null', () => {
    const score = computeThumbsScore({
      groupSize: 5,
      gameThumbs: [],
      totalGroupThumbs: 0,
      steamPctPositive: null,
    });
    expect(score).toBeCloseTo(0.5, 5);
  });

  test('uses base score (no Steam blend) once cold-start ends (>=5 thumbs)', () => {
    const score = computeThumbsScore({
      groupSize: 5,
      gameThumbs: [],
      totalGroupThumbs: 5,
      steamPctPositive: 95,
    });
    expect(score).toBeCloseTo(0.5, 5);
  });
});

describe('computeOwnershipScore', () => {
  test('returns 1.0 when everyone owns', () => {
    expect(computeOwnershipScore({ ownerCount: 5, groupSize: 5 })).toBe(1.0);
  });

  test('returns 0.5 for half-owned', () => {
    expect(computeOwnershipScore({ ownerCount: 4, groupSize: 8 })).toBe(0.5);
  });

  test('returns 0.0 for ownerCount 0', () => {
    expect(computeOwnershipScore({ ownerCount: 0, groupSize: 8 })).toBe(0.0);
  });

  test('returns 0.0 when groupSize is 0 (avoid div-by-zero)', () => {
    expect(computeOwnershipScore({ ownerCount: 0, groupSize: 0 })).toBe(0.0);
  });
});

describe('computeNoveltyScore', () => {
  const NOW = new Date('2026-05-04T00:00:00Z');

  test('returns 1.0 when nobody has played (maxLastPlayed null)', () => {
    expect(computeNoveltyScore({ maxLastPlayed: null, now: NOW })).toBe(1.0);
  });

  test('returns 1.0 when last played 30+ days ago', () => {
    expect(
      computeNoveltyScore({
        maxLastPlayed: '2026-04-01T00:00:00Z', // 33 days ago
        now: NOW,
      }),
    ).toBe(1.0);
  });

  test('returns 0.0 when played today', () => {
    expect(
      computeNoveltyScore({
        maxLastPlayed: '2026-05-04T00:00:00Z',
        now: NOW,
      }),
    ).toBeCloseTo(0.0, 3);
  });

  test('returns 0.5 at 15 days', () => {
    expect(
      computeNoveltyScore({
        maxLastPlayed: '2026-04-19T00:00:00Z', // 15 days ago
        now: NOW,
      }),
    ).toBeCloseTo(0.5, 3);
  });

  test('caps at 1.0 (no boost beyond 30 days)', () => {
    expect(
      computeNoveltyScore({
        maxLastPlayed: '2026-01-01T00:00:00Z', // 123 days ago
        now: NOW,
      }),
    ).toBe(1.0);
  });
});

describe('rankByThumbs', () => {
  const NOW = new Date('2026-05-04T00:00:00Z');
  const WEIGHTS = { thumbs: 0.5, ownership: 0.3, novelty: 0.2 };

  test('ranks games by composite score (descending)', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [
        {
          id: 'a',
          name: 'Alpha',
          steamReviewPctPositive: 80,
          metadataSyncedAt: NOW.toISOString(),
        },
        {
          id: 'b',
          name: 'Beta',
          steamReviewPctPositive: 90,
          metadataSyncedAt: NOW.toISOString(),
        },
      ],
      thumbs: new Map([
        [
          'a',
          [
            { userId: 'u1', vote: 1 },
            { userId: 'u2', vote: 1 },
          ],
        ],
        ['b', [{ userId: 'u1', vote: -1 }]],
      ]),
      ownership: new Map([
        ['a', { ownerCount: 4, maxLastPlayed: null }],
        ['b', { ownerCount: 2, maxLastPlayed: '2026-04-30T00:00:00Z' }],
      ]),
      weights: WEIGHTS,
      now: NOW,
    });

    expect(result.picks.length).toBe(2);
    expect(result.picks[0]!.gameId).toBe('a');
    expect(result.picks[1]!.gameId).toBe('b');
  });

  test('emits cold-start flag when group has < 5 total thumbs', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [
        {
          id: 'a',
          name: 'Alpha',
          steamReviewPctPositive: 80,
          metadataSyncedAt: NOW.toISOString(),
        },
      ],
      thumbs: new Map(),
      ownership: new Map([['a', { ownerCount: 1, maxLastPlayed: null }]]),
      weights: WEIGHTS,
      now: NOW,
    });

    expect(result.coldStart).toBe(true);
    expect(result.picks[0]!.flags).toContain('cold-start');
  });

  test('higher Steam pct wins for tied scores (cold-start blend already favors Beta)', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [
        {
          id: 'a',
          name: 'Alpha',
          steamReviewPctPositive: 70,
          metadataSyncedAt: NOW.toISOString(),
        },
        {
          id: 'b',
          name: 'Beta',
          steamReviewPctPositive: 90,
          metadataSyncedAt: NOW.toISOString(),
        },
      ],
      thumbs: new Map(),
      ownership: new Map([
        ['a', { ownerCount: 2, maxLastPlayed: null }],
        ['b', { ownerCount: 2, maxLastPlayed: null }],
      ]),
      weights: WEIGHTS,
      now: NOW,
    });
    expect(result.picks[0]!.gameId).toBe('b');
  });

  test('emits never-played flag when maxLastPlayed is null', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [
        {
          id: 'a',
          name: 'Alpha',
          steamReviewPctPositive: null,
          metadataSyncedAt: NOW.toISOString(),
        },
      ],
      thumbs: new Map(),
      ownership: new Map([['a', { ownerCount: 1, maxLastPlayed: null }]]),
      weights: WEIGHTS,
      now: NOW,
    });
    expect(result.picks[0]!.flags).toContain('never-played');
  });

  test('emits not-enriched flag when metadataSyncedAt is null', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [
        { id: 'a', name: 'Alpha', steamReviewPctPositive: null, metadataSyncedAt: null },
      ],
      thumbs: new Map(),
      ownership: new Map([['a', { ownerCount: 1, maxLastPlayed: '2026-04-01T00:00:00Z' }]]),
      weights: WEIGHTS,
      now: NOW,
    });
    expect(result.picks[0]!.flags).toContain('not-enriched');
  });

  test('emits low-confidence flag when game has 0-1 thumbs', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 8 },
      candidates: [
        {
          id: 'a',
          name: 'Alpha',
          steamReviewPctPositive: 80,
          metadataSyncedAt: NOW.toISOString(),
        },
      ],
      thumbs: new Map([['a', [{ userId: 'u1', vote: 1 }]]]),
      ownership: new Map([['a', { ownerCount: 4, maxLastPlayed: null }]]),
      weights: WEIGHTS,
      now: NOW,
    });
    expect(result.picks[0]!.flags).toContain('low-confidence');
  });

  test('returns empty picks for empty candidates', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [],
      thumbs: new Map(),
      ownership: new Map(),
      weights: WEIGHTS,
      now: NOW,
    });
    expect(result.picks).toEqual([]);
  });

  test('echoes weights in result', () => {
    const result = rankByThumbs({
      group: { id: 'g1', size: 4 },
      candidates: [],
      thumbs: new Map(),
      ownership: new Map(),
      weights: { thumbs: 0.6, ownership: 0.2, novelty: 0.2 },
      now: NOW,
    });
    expect(result.weightsUsed).toEqual({ thumbs: 0.6, ownership: 0.2, novelty: 0.2 });
  });
});

describe('computeGroupFitScore', () => {
  test('returns 1.0 inside the optimal range', () => {
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
    expect(computeGroupFitScore({ groupSize: 2, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
    expect(computeGroupFitScore({ groupSize: 6, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(1.0);
  });

  test('decays at -0.25 per step below the range, floors at 0', () => {
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.75);
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 4, optimalMax: 6 })).toBeCloseTo(0.25);
    expect(computeGroupFitScore({ groupSize: 1, optimalMin: 8, optimalMax: 10 })).toBe(0); // floored
  });

  test('decays at -0.15 per step above the range, floors at 0', () => {
    expect(computeGroupFitScore({ groupSize: 7, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.85);
    expect(computeGroupFitScore({ groupSize: 8, optimalMin: 2, optimalMax: 6 })).toBeCloseTo(0.7);
    expect(computeGroupFitScore({ groupSize: 20, optimalMin: 2, optimalMax: 6 })).toBe(0);
  });

  test('returns 0.5 when optimal range is missing (neutral fallback)', () => {
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: null, optimalMax: null })).toBe(0.5);
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: 2, optimalMax: null })).toBe(0.5);
    expect(computeGroupFitScore({ groupSize: 4, optimalMin: null, optimalMax: 6 })).toBe(0.5);
  });
});
