import type {
  Person, RecommendationContext, RatingCache, SessionRecord, OwnsLookup, StablePrefs,
} from '@gno/recommender';
import { kv } from './kv-client.js';
import { loadGroupBundle } from './people.js';

interface AggregatedState {
  ratingCache: Record<string, RatingCache>;
  ownership: Record<string, Record<string, boolean>>;
  prefs: Record<string, StablePrefs>;
  tonight: Record<string, { mood?: number; timeAvailableMins?: number | null }>;
  sessions: SessionRecord[];
}

export async function fetchState(): Promise<AggregatedState> {
  return kv.get<AggregatedState>('/state');
}

export async function buildContext(
  attendeeIds: string[],
  timeAvailableMins: number | null,
): Promise<RecommendationContext> {
  const [bundle, state] = await Promise.all([loadGroupBundle(), fetchState()]);

  const attendees: Person[] = attendeeIds
    .map((id) => bundle.people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p))
    .map((p) => ({ ...p, stablePrefs: state.prefs[p.id] ?? p.stablePrefs }));

  const owns: OwnsLookup = {};
  for (const a of attendees) owns[a.id] = state.ownership[a.id] ?? {};

  return {
    group: bundle.group,
    attendees,
    owns,
    tonight: { timeAvailableMins, mood: null },
    sessions: state.sessions,
    ratingCacheGroup: state.ratingCache,
    ratingCacheGlobal: {},
  };
}
