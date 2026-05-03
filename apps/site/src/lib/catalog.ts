import games from '@data/games.json' assert { type: 'json' };
import type { Game } from '@gno/recommender';

export const CATALOG = games as Game[];

export function getGame(id: string): Game | undefined {
  return CATALOG.find((g) => g.id === id);
}
