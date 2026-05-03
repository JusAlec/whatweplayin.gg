import { effectiveRating } from './effective-rating.js';
import { VOTED_DIMS } from './types.js';
import type { Game, Person, RatingCache } from './types.js';

const MAX_DISTANCE = 4;

export function dimMatch(personPref: number, gameRating: number): number {
  return 1 - Math.abs(personPref - gameRating) / MAX_DISTANCE;
}

function attendeePreferenceMatch(
  person: Person,
  game: Game,
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
): number {
  let sum = 0;
  for (const dim of VOTED_DIMS) {
    const r = effectiveRating(groupCache, globalCache, game.id, dim);
    sum += dimMatch(person.stablePrefs[dim], r.value);
  }
  return sum / VOTED_DIMS.length;
}

export function preferenceMatch(
  game: Game,
  attendees: Person[],
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
): number {
  if (attendees.length === 0) return 0;
  const totalWeight = attendees.reduce((s, a) => s + (a.weight ?? 1), 0);
  const weightedSum = attendees.reduce(
    (sum, a) => sum + (a.weight ?? 1) * attendeePreferenceMatch(a, game, groupCache, globalCache),
    0,
  );
  return weightedSum / totalWeight;
}
