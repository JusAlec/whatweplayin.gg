import { preferenceMatch } from './preference-match.js';
import { groupFit } from './group-fit.js';
import { sessionFit } from './session-fit.js';
import { novelty } from './novelty.js';
import { confidenceLevel } from './effective-rating.js';
import { VOTED_DIMS } from './types.js';
import type { Game, GameFlag, RatingCache, RecommendationContext, ScoredGame } from './types.js';

const HIGH_VARIANCE_THRESHOLD = 1.0;

export function maxVarianceForGame(
  groupCache: Record<string, RatingCache | undefined>,
  globalCache: Record<string, RatingCache | undefined>,
  gameId: string,
): number {
  const sources = [groupCache[gameId], globalCache[gameId]];
  let max = 0;
  for (const cache of sources) {
    if (!cache) continue;
    for (const dim of VOTED_DIMS) {
      const entry = cache[dim];
      if (entry && entry.n > 0 && entry.variance > max) max = entry.variance;
    }
  }
  return max;
}

function collectFlags(
  _game: Game,
  ctx: RecommendationContext,
  conf: string,
  maxVar: number,
): GameFlag[] {
  const flags: GameFlag[] = [];
  if (conf === 'none' || conf === 'partial') flags.push('low-confidence');
  if (maxVar > HIGH_VARIANCE_THRESHOLD) flags.push('high-variance');
  if (ctx.attendees.length === 1) flags.push('solo');
  return flags;
}

export function score(game: Game, ctx: RecommendationContext): ScoredGame {
  const w = ctx.group.scoringWeights;
  const pref = preferenceMatch(game, ctx.attendees, ctx.ratingCacheGroup, ctx.ratingCacheGlobal);
  const fit = groupFit(game, ctx.attendees);
  const sess = sessionFit(
    game,
    ctx.tonight.timeAvailableMins,
    ctx.ratingCacheGroup,
    ctx.ratingCacheGlobal,
  );
  const nov = novelty(game, ctx.sessions);

  const total = w.preferenceMatch * pref + w.groupFit * fit + w.sessionFit * sess + w.novelty * nov;

  const conf = confidenceLevel(ctx.ratingCacheGroup, ctx.ratingCacheGlobal, game.id);
  const maxVar = maxVarianceForGame(ctx.ratingCacheGroup, ctx.ratingCacheGlobal, game.id);

  return {
    game: game.id,
    score: total,
    confidence: conf,
    maxVariance: maxVar,
    breakdown: {
      preferenceMatch: {
        value: pref,
        weight: w.preferenceMatch,
        contribution: w.preferenceMatch * pref,
      },
      groupFit: { value: fit, weight: w.groupFit, contribution: w.groupFit * fit },
      sessionFit: { value: sess, weight: w.sessionFit, contribution: w.sessionFit * sess },
      novelty: { value: nov, weight: w.novelty, contribution: w.novelty * nov },
    },
    flags: collectFlags(game, ctx, conf, maxVar),
  };
}
