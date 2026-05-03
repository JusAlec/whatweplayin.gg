import type { Game, Person } from './types.js';

const FALLOFF_PER_STEP = 0.2;
const FLOOR = 0.4;

export function groupFit(game: Game, attendees: Person[]): number {
  const n = attendees.length;
  const { min, max } = game.optimalPlayers;
  if (n >= min && n <= max) return 1.0;
  const distFromOptimal = n < min ? min - n : n - max;
  return Math.max(FLOOR, 1 - FALLOFF_PER_STEP * distFromOptimal);
}
