// v2.1 thumbs-based recommender. Pure function, no D1 reads, no side effects.

export interface RankInput {
  group: { id: string; size: number };
  candidates: EnrichedGameForRanking[];
  thumbs: Map<string, Array<{ userId: string; vote: -1 | 1 }>>;
  ownership: Map<string, { ownerCount: number; maxLastPlayed: string | null }>;
  weights: { thumbs: number; ownership: number; novelty: number };
  now: Date;
}

export interface EnrichedGameForRanking {
  id: string;
  name: string;
  steamReviewPctPositive: number | null;
  metadataSyncedAt: string | null;
}

export type GameFlag = 'cold-start' | 'low-confidence' | 'not-enriched' | 'never-played';

export interface RankResult {
  picks: Array<{
    gameId: string;
    score: number;
    breakdown: { thumbs: number; ownership: number; novelty: number };
    flags: GameFlag[];
  }>;
  weightsUsed: { thumbs: number; ownership: number; novelty: number };
  coldStart: boolean;
}

const COLD_START_THRESHOLD = 5; // total group thumbs below which we use Steam blend
const NOVELTY_DECAY_DAYS = 30;
const TIE_EPSILON = 0.001;

export interface ThumbsScoreInput {
  groupSize: number;
  gameThumbs: Array<{ vote: -1 | 1 }>;
  totalGroupThumbs: number;
  steamPctPositive: number | null;
}

export function computeThumbsScore(input: ThumbsScoreInput): number {
  const sum = input.gameThumbs.reduce((acc, t) => acc + t.vote, 0);
  const avg = input.groupSize > 0 ? sum / input.groupSize : 0;
  const base = (avg + 1) / 2;

  const isColdStart = input.totalGroupThumbs < COLD_START_THRESHOLD;
  if (isColdStart && input.steamPctPositive != null) {
    return 0.5 * base + 0.5 * (input.steamPctPositive / 100);
  }
  return base;
}
