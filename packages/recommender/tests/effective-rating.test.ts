import { test, expect, describe } from 'vitest';
import { effectiveRating, confidenceLevel } from '../src/effective-rating.js';
import type { RatingCache } from '../src/types.js';

const cache = (avg: number, n: number, variance = 0.2): RatingCache['combat'] => ({
  avg, variance, n,
});

const fullCache = (vals: Partial<Record<string, { avg: number; n: number; variance?: number }>>): RatingCache => {
  const dims = ['combat', 'grind', 'buildingDepth', 'commitmentLevel', 'pvpFocus', 'sessionLength'] as const;
  const out = {} as RatingCache;
  for (const d of dims) {
    const v = vals[d] ?? { avg: 3, n: 0, variance: 0 };
    out[d] = { avg: v.avg, n: v.n, variance: v.variance ?? 0 };
  }
  return out;
};

describe('effectiveRating', () => {
  test('returns group rating when group has >= 1 vote', () => {
    const groupCache = { valheim: fullCache({ combat: { avg: 4.2, n: 3 } }) };
    const r = effectiveRating(groupCache, {}, 'valheim', 'combat');
    expect(r).toEqual({ value: 4.2, confidence: 'group' });
  });

  test('falls back to global when group has 0 votes and global has >= 3', () => {
    const groupCache = {};
    const globalCache = { valheim: fullCache({ combat: { avg: 3.8, n: 5 } }) };
    const r = effectiveRating(groupCache, globalCache, 'valheim', 'combat');
    expect(r).toEqual({ value: 3.8, confidence: 'global' });
  });

  test('falls back to neutral 3 when global has < 3 votes', () => {
    const groupCache = {};
    const globalCache = { valheim: fullCache({ combat: { avg: 5, n: 2 } }) };
    const r = effectiveRating(groupCache, globalCache, 'valheim', 'combat');
    expect(r).toEqual({ value: 3, confidence: 'none' });
  });

  test('falls back to neutral 3 when game absent from both caches', () => {
    expect(effectiveRating({}, {}, 'valheim', 'combat')).toEqual({ value: 3, confidence: 'none' });
  });
});

describe('confidenceLevel', () => {
  test('group when all dims have group votes', () => {
    const groupCache = {
      valheim: fullCache({
        combat: { avg: 3, n: 1 },
        grind: { avg: 3, n: 1 },
        buildingDepth: { avg: 3, n: 1 },
        commitmentLevel: { avg: 3, n: 1 },
        pvpFocus: { avg: 3, n: 1 },
        sessionLength: { avg: 3, n: 1 },
      }),
    };
    expect(confidenceLevel(groupCache, {}, 'valheim')).toBe('group');
  });

  test('global when all dims fall back to global', () => {
    const globalCache = {
      valheim: fullCache({
        combat: { avg: 3, n: 5 },
        grind: { avg: 3, n: 5 },
        buildingDepth: { avg: 3, n: 5 },
        commitmentLevel: { avg: 3, n: 5 },
        pvpFocus: { avg: 3, n: 5 },
        sessionLength: { avg: 3, n: 5 },
      }),
    };
    expect(confidenceLevel({}, globalCache, 'valheim')).toBe('global');
  });

  test('none when all dims fall back to neutral default', () => {
    expect(confidenceLevel({}, {}, 'valheim')).toBe('none');
  });

  test('partial when sources mix', () => {
    const groupCache = {
      valheim: fullCache({ combat: { avg: 3, n: 1 } }),
    };
    const globalCache = {
      valheim: fullCache({ grind: { avg: 3, n: 5 } }),
    };
    expect(confidenceLevel(groupCache, globalCache, 'valheim')).toBe('partial');
  });
});
