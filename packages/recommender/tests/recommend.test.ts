import { test, expect, describe } from 'vitest';
import { recommend } from '../src/recommend.js';
import type { Game, Person, RatingCache, RecommendationContext, GroupSettings } from '../src/types.js';

const groupSettings: GroupSettings = {
  id: 'g1', displayName: 'g', secretHash: 'x',
  scoringWeights: { preferenceMatch: 0.4, groupFit: 0.25, sessionFit: 0.2, novelty: 0.15 },
};

const game = (id: string, over: Partial<Game> = {}): Game => ({
  id, name: id, minPlayers: 1, maxPlayers: 4, optimalPlayers: { min: 2, max: 4 },
  hostingModel: 'p2p', releaseStatus: 'released',
  hasSinglePlayer: true, hasCoop: true, hasPvP: false, genre: ['survival'],
  ...over,
});

const person = (id: string, n: number): Person => ({
  id, displayName: id,
  stablePrefs: { combat: n, grind: n, buildingDepth: n, commitmentLevel: n, pvpFocus: n, sessionLength: n },
});

const allRated = (avg: number): RatingCache => ({
  combat: { avg, variance: 0, n: 5 },
  grind: { avg, variance: 0, n: 5 },
  buildingDepth: { avg, variance: 0, n: 5 },
  commitmentLevel: { avg, variance: 0, n: 5 },
  pvpFocus: { avg, variance: 0, n: 5 },
  sessionLength: { avg, variance: 0, n: 5 },
});

const ctx = (over: Partial<RecommendationContext> = {}): RecommendationContext => ({
  group: groupSettings,
  attendees: [person('alec', 3), person('mike', 3)],
  owns: { alec: { valheim: true, ark: true }, mike: { valheim: true, ark: true } },
  tonight: { timeAvailableMins: 120, mood: null },
  sessions: [],
  ratingCacheGroup: { valheim: allRated(3), ark: allRated(3) },
  ratingCacheGlobal: {},
  ...over,
});

describe('recommend', () => {
  test('returns picks (top 3), alsoConsidered (next 5), and excluded', () => {
    const games = [game('valheim'), game('ark')];
    const out = recommend(games, ctx());
    expect(out.picks.length).toBe(2);
    expect(out.alsoConsidered.length).toBe(0);
    expect(out.excluded).toEqual([]);
  });

  test('caps picks at 3 and alsoConsidered at 5', () => {
    const games = Array.from({ length: 12 }, (_, i) => game(`g${i}`));
    const owns = Object.fromEntries(
      games.map((g) => [g.id, true]),
    );
    const c = ctx({
      owns: { alec: owns, mike: owns },
      ratingCacheGroup: Object.fromEntries(games.map((g) => [g.id, allRated(3)])),
    });
    const out = recommend(games, c);
    expect(out.picks.length).toBe(3);
    expect(out.alsoConsidered.length).toBe(5);
  });

  test('excludes games failing the hard filter with reasons', () => {
    const games = [game('valheim'), game('ark', { minPlayers: 4, maxPlayers: 10 })];
    const out = recommend(games, ctx());
    expect(out.picks.map((p) => p.game)).toEqual(['valheim']);
    expect(out.excluded.find((e) => e.game === 'ark')?.reason).toMatch(/needs 4-10 players/);
  });

  test('context is populated correctly', () => {
    const games = [game('valheim')];
    const out = recommend(games, ctx());
    expect(out.context.attendeeIds).toEqual(['alec', 'mike']);
    expect(out.context.timeAvailableMins).toBe(120);
    expect(out.context.candidatePoolSize).toBe(1);
    expect(out.context.weightsUsed).toEqual(groupSettings.scoringWeights);
  });

  test('returns empty picks when no games pass filter', () => {
    const games = [game('ark', { minPlayers: 5, maxPlayers: 10 })];
    const out = recommend(games, ctx());
    expect(out.picks).toEqual([]);
    expect(out.excluded.length).toBe(1);
  });
});
