import { passesFilter, explainExclusion } from './filters.js';
import { score } from './score.js';
import { rankCandidates } from './rank.js';
import type { Game, RecommendationContext, RecommendationResponse } from './types.js';

const PICKS_TOP_N = 3;
const ALSO_CONSIDERED_N = 5;

export function recommend(games: Game[], ctx: RecommendationContext): RecommendationResponse {
  const candidates: Game[] = [];
  const excluded: { game: string; reason: string }[] = [];

  for (const g of games) {
    if (passesFilter(g, ctx.attendees, ctx.owns)) candidates.push(g);
    else excluded.push({ game: g.id, reason: explainExclusion(g, ctx.attendees, ctx.owns) });
  }

  const scored = candidates.map((g) => score(g, ctx));
  const ranked = rankCandidates(scored);

  return {
    picks: ranked.slice(0, PICKS_TOP_N),
    alsoConsidered: ranked.slice(PICKS_TOP_N, PICKS_TOP_N + ALSO_CONSIDERED_N),
    excluded,
    context: {
      attendeeIds: ctx.attendees.map((a) => a.id),
      timeAvailableMins: ctx.tonight.timeAvailableMins,
      weightsUsed: ctx.group.scoringWeights,
      candidatePoolSize: candidates.length,
    },
  };
}
