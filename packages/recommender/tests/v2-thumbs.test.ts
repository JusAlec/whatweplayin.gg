import { describe, test, expect } from 'vitest';
import { computeThumbsScore } from '../src/v2-thumbs.js';

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
