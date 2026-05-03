import type { Game, SessionRecord } from './types.js';

const RECENCY_WEIGHTS = [1.0, 0.5, 0.25, 0.125, 0.0625];
const WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function daysAgo(iso: string, now = Date.now()): number {
  return (now - new Date(iso).getTime()) / MS_PER_DAY;
}

export function novelty(game: Game, sessions: SessionRecord[], now = Date.now()): number {
  const recent = sessions
    .filter((s) => daysAgo(s.startedAt, now) <= WINDOW_DAYS)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, RECENCY_WEIGHTS.length);

  const penalty = recent.reduce(
    (sum, s, i) => sum + (s.gamePicked === game.id ? RECENCY_WEIGHTS[i]! : 0),
    0,
  );
  return Math.max(0, 1 - penalty);
}
