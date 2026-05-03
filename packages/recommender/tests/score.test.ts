import { test, expect, describe } from 'vitest';
import fc from 'fast-check';
import { score, maxVarianceForGame } from '../src/score.js';
import type {
  Game,
  Person,
  RatingCache,
  RecommendationContext,
  GroupSettings,
} from '../src/types.js';

const groupSettings: GroupSettings = {
  id: 'g1',
  displayName: 'Test Group',
  secretHash: 'x',
  scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
};

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

const person = (id: string, n: number): Person => ({
  id,
  displayName: id,
  stablePrefs: {
    combat: n,
    grind: n,
    buildingDepth: n,
    commitmentLevel: n,
    pvpFocus: n,
    sessionLength: n,
  },
});

const allRated = (avg: number): RatingCache => ({
  combat: { avg, variance: 0.1, n: 5 },
  grind: { avg, variance: 0.1, n: 5 },
  buildingDepth: { avg, variance: 0.1, n: 5 },
  commitmentLevel: { avg, variance: 0.1, n: 5 },
  pvpFocus: { avg, variance: 0.1, n: 5 },
  sessionLength: { avg, variance: 0.1, n: 5 },
});

const ctx = (over: Partial<RecommendationContext> = {}): RecommendationContext => ({
  group: groupSettings,
  attendees: [person('alec', 3), person('mike', 3)],
  owns: { alec: { valheim: true }, mike: { valheim: true } },
  tonight: { timeAvailableMins: 120, mood: null },
  sessions: [],
  ratingCacheGroup: { valheim: allRated(3) },
  ratingCacheGlobal: {},
  ...over,
});

describe('score', () => {
  test('returns score in [0, 1]', () => {
    const result = score(game, ctx());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('breakdown contributions sum to total score (within float tolerance)', () => {
    const r = score(game, ctx());
    const sum =
      r.breakdown.preferenceMatch.contribution +
      r.breakdown.groupFit.contribution +
      r.breakdown.sessionFit.contribution +
      r.breakdown.novelty.contribution;
    expect(sum).toBeCloseTo(r.score, 5);
  });

  test('confidence is "group" when all dims have group ratings', () => {
    expect(score(game, ctx()).confidence).toBe('group');
  });

  test('confidence is "none" when caches are empty', () => {
    expect(score(game, ctx({ ratingCacheGroup: {}, ratingCacheGlobal: {} })).confidence).toBe(
      'none',
    );
  });

  test('flags low-confidence when confidence is none', () => {
    const r = score(game, ctx({ ratingCacheGroup: {}, ratingCacheGlobal: {} }));
    expect(r.flags).toContain('low-confidence');
  });

  test('flags high-variance when any dim variance > 1.0', () => {
    const noisy: RatingCache = {
      combat: { avg: 3, variance: 1.5, n: 5 },
      grind: { avg: 3, variance: 0, n: 5 },
      buildingDepth: { avg: 3, variance: 0, n: 5 },
      commitmentLevel: { avg: 3, variance: 0, n: 5 },
      pvpFocus: { avg: 3, variance: 0, n: 5 },
      sessionLength: { avg: 3, variance: 0, n: 5 },
    };
    const r = score(game, ctx({ ratingCacheGroup: { valheim: noisy } }));
    expect(r.flags).toContain('high-variance');
  });
});

describe('maxVarianceForGame', () => {
  test('returns the highest variance across all dims (group > global > 0)', () => {
    const cache: RatingCache = {
      combat: { avg: 3, variance: 0.5, n: 5 },
      grind: { avg: 3, variance: 1.2, n: 5 },
      buildingDepth: { avg: 3, variance: 0, n: 5 },
      commitmentLevel: { avg: 3, variance: 0, n: 5 },
      pvpFocus: { avg: 3, variance: 0, n: 5 },
      sessionLength: { avg: 3, variance: 0, n: 5 },
    };
    expect(maxVarianceForGame({ valheim: cache }, {}, 'valheim')).toBe(1.2);
  });

  test('returns 0 when game has no votes anywhere', () => {
    expect(maxVarianceForGame({}, {}, 'valheim')).toBe(0);
  });
});

describe('property: score is always in [0, 1]', () => {
  test('holds across many random inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 30, max: 480 }),
        (rating, time) => {
          const r = score(
            game,
            ctx({
              ratingCacheGroup: { valheim: allRated(rating) },
              tonight: { timeAvailableMins: time, mood: null },
            }),
          );
          return r.score >= 0 && r.score <= 1;
        },
      ),
      { numRuns: 200 },
    );
  });
});
