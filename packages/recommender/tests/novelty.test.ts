import { test, expect, describe } from 'vitest';
import { novelty } from '../src/novelty.js';
import type { Game, SessionRecord } from '../src/types.js';

const game = (id: string): Game => ({
  id, name: id, minPlayers: 1, maxPlayers: 4, optimalPlayers: { min: 1, max: 4 },
  hostingModel: 'p2p', releaseStatus: 'released',
  hasSinglePlayer: true, hasCoop: true, hasPvP: false, genre: ['survival'],
});

const session = (gameId: string, daysAgo: number): SessionRecord => ({
  startedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  attendees: ['alec'],
  gamePicked: gameId,
});

describe('novelty', () => {
  test('1.0 when no sessions logged', () => {
    expect(novelty(game('valheim'), [])).toBe(1.0);
  });

  test('1.0 when game never played in last 30 days', () => {
    expect(novelty(game('valheim'), [session('ark-asa', 1)])).toBe(1.0);
  });

  test('1.0 when game last played > 30 days ago', () => {
    expect(novelty(game('valheim'), [session('valheim', 45)])).toBe(1.0);
  });

  test('0 when game played in most recent session', () => {
    const sessions = [session('valheim', 1), session('ark-asa', 5)];
    expect(novelty(game('valheim'), sessions)).toBe(0);
  });

  test('0.5 when game played in second-most-recent slot only', () => {
    const sessions = [session('ark-asa', 1), session('valheim', 5)];
    expect(novelty(game('valheim'), sessions)).toBe(0.5);
  });

  test('penalties accumulate across multiple recent sessions', () => {
    const sessions = [
      session('valheim', 1),
      session('valheim', 5),
      session('ark-asa', 10),
    ];
    expect(novelty(game('valheim'), sessions)).toBe(0);
  });

  test('only considers the 5 most recent sessions in window', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => session('valheim', i + 1));
    expect(novelty(game('valheim'), sessions)).toBe(0);
  });
});
