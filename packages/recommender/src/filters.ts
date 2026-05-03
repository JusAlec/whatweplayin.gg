import type { Game, Person, OwnsLookup } from './types.js';

export function passesFilter(game: Game, attendees: Person[], owns: OwnsLookup): boolean {
  if (attendees.length < game.minPlayers) return false;
  if (attendees.length > game.maxPlayers) return false;
  return attendees.every((a) => owns[a.id]?.[game.id] === true);
}

export function explainExclusion(game: Game, attendees: Person[], owns: OwnsLookup): string {
  const reasons: string[] = [];
  const n = attendees.length;
  if (n < game.minPlayers || n > game.maxPlayers) {
    reasons.push(`needs ${game.minPlayers}-${game.maxPlayers} players, you have ${n}`);
  }
  const missingOwners = attendees
    .filter((a) => owns[a.id]?.[game.id] !== true)
    .map((a) => a.displayName);
  if (missingOwners.length > 0) {
    const list = missingOwners.join(', ');
    reasons.push(`${list} doesn't own this game`);
  }
  return reasons.join('; ') || 'unknown reason';
}
