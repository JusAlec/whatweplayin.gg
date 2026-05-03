import { test, expect, describe } from 'vitest';
import fc from 'fast-check';
import { rankCandidates } from '../src/rank.js';
import type { ScoredGame } from '../src/types.js';

const make = (over: Partial<ScoredGame>): ScoredGame => ({
  game: 'g',
  score: 0.5,
  confidence: 'group',
  maxVariance: 0.1,
  breakdown: {
    preferenceMatch: { value: 0, weight: 0.4, contribution: 0 },
    groupFit: { value: 0, weight: 0.25, contribution: 0 },
    sessionFit: { value: 0, weight: 0.2, contribution: 0 },
    novelty: { value: 0, weight: 0.15, contribution: 0 },
  },
  flags: [],
  ...over,
});

describe('rankCandidates', () => {
  test('orders by score descending', () => {
    const out = rankCandidates([
      make({ game: 'a', score: 0.4 }),
      make({ game: 'b', score: 0.8 }),
      make({ game: 'c', score: 0.6 }),
    ]);
    expect(out.map((x) => x.game)).toEqual(['b', 'c', 'a']);
  });

  test('ties broken by confidence (group > global > partial > none)', () => {
    const out = rankCandidates([
      make({ game: 'a', score: 0.5, confidence: 'none' }),
      make({ game: 'b', score: 0.5, confidence: 'group' }),
      make({ game: 'c', score: 0.5, confidence: 'global' }),
      make({ game: 'd', score: 0.5, confidence: 'partial' }),
    ]);
    expect(out.map((x) => x.game)).toEqual(['b', 'c', 'd', 'a']);
  });

  test('ties at same confidence broken by lower variance', () => {
    const out = rankCandidates([
      make({ game: 'a', score: 0.5, maxVariance: 1.5 }),
      make({ game: 'b', score: 0.5, maxVariance: 0.2 }),
    ]);
    expect(out.map((x) => x.game)).toEqual(['b', 'a']);
  });

  test('further ties broken alphabetically', () => {
    const out = rankCandidates([
      make({ game: 'zelda', score: 0.5, maxVariance: 0.1 }),
      make({ game: 'ark', score: 0.5, maxVariance: 0.1 }),
    ]);
    expect(out.map((x) => x.game)).toEqual(['ark', 'zelda']);
  });

  test('property: ranking is invariant to input order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            game: fc.string({ minLength: 1, maxLength: 8 }),
            score: fc.float({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 2, maxLength: 8 },
        ),
        (items) => {
          const seen = new Set<string>();
          const unique = items.filter((i) => (seen.has(i.game) ? false : (seen.add(i.game), true)));
          if (unique.length < 2) return true;
          const scored = unique.map((i) => make({ game: i.game, score: i.score }));
          const a = rankCandidates([...scored]).map((x) => x.game);
          const b = rankCandidates([...scored].reverse()).map((x) => x.game);
          return JSON.stringify(a) === JSON.stringify(b);
        },
      ),
      { numRuns: 100 },
    );
  });
});
