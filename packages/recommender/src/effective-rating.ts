import { VOTED_DIMS } from './types.js';
import type { DimConfidence, GameConfidence, RatingCache, VotedDim } from './types.js';

const NEUTRAL_DEFAULT = 3;
const GLOBAL_MIN_N = 3;

export function effectiveRating(
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
  gameId: string,
  dim: VotedDim,
): { value: number; confidence: DimConfidence } {
  const group = groupCache[gameId]?.[dim];
  if (group && group.n >= 1) return { value: group.avg, confidence: 'group' };

  const global = globalCache[gameId]?.[dim];
  if (global && global.n >= GLOBAL_MIN_N) return { value: global.avg, confidence: 'global' };

  return { value: NEUTRAL_DEFAULT, confidence: 'none' };
}

export function confidenceLevel(
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
  gameId: string,
): GameConfidence {
  const sources = VOTED_DIMS.map((d) => effectiveRating(groupCache, globalCache, gameId, d).confidence);
  if (sources.every((s) => s === 'group')) return 'group';
  if (sources.every((s) => s === 'global')) return 'global';
  if (sources.every((s) => s === 'none')) return 'none';
  return 'partial';
}
