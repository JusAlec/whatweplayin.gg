import { effectiveRating } from './effective-rating.js';
import type { Game, RatingCache } from './types.js';

export const SESSION_LENGTH_MINS: Record<number, number> = {
  1: 30,
  2: 60,
  3: 120,
  4: 240,
  5: 480,
};

const NULL_TIME_NEUTRAL = 0.8;

export function sessionFit(
  game: Game,
  timeAvailableMins: number | null,
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
): number {
  if (timeAvailableMins == null) return NULL_TIME_NEUTRAL;
  const r = effectiveRating(groupCache, globalCache, game.id, 'sessionLength');
  const bucket = Math.max(1, Math.min(5, Math.round(r.value)));
  const requiredMins = SESSION_LENGTH_MINS[bucket]!;
  if (timeAvailableMins >= requiredMins) return 1.0;
  return timeAvailableMins / requiredMins;
}
