import type { GameConfidence, ScoredGame } from './types.js';

const SCORE_TIE_EPSILON = 0.01;
const VARIANCE_TIE_EPSILON = 0.1;

const CONFIDENCE_ORDER: Record<GameConfidence, number> = {
  group: 0,
  global: 1,
  partial: 2,
  none: 3,
};

export function rankCandidates(scored: ScoredGame[]): ScoredGame[] {
  return [...scored].sort((a, b) => {
    if (Math.abs(a.score - b.score) > SCORE_TIE_EPSILON) return b.score - a.score;
    if (a.confidence !== b.confidence)
      return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
    if (Math.abs(a.maxVariance - b.maxVariance) > VARIANCE_TIE_EPSILON)
      return a.maxVariance - b.maxVariance;
    return a.game.localeCompare(b.game);
  });
}
