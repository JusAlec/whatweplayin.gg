import { describe, test, expect } from 'vitest';
import {
  computeThumbsScore,
  computeOwnershipScore,
  computeNoveltyScore,
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
