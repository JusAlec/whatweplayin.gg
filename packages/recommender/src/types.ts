export const VOTED_DIMS = [
  'combat',
  'grind',
  'buildingDepth',
  'commitmentLevel',
  'pvpFocus',
  'sessionLength',
] as const;

export type VotedDim = (typeof VOTED_DIMS)[number];

export type DimConfidence = 'group' | 'global' | 'none';
export type GameConfidence = 'group' | 'global' | 'partial' | 'none';

export type StablePrefs = Record<VotedDim, number>;

export interface Game {
  id: string;
  name: string;
  aliases?: string[];
  steamAppId?: number;
  hltbId?: string;
  storeUrls?: { steam?: string; epic?: string; gog?: string };
  minPlayers: number;
  maxPlayers: number;
  optimalPlayers: { min: number; max: number };
  hostingModel: 'p2p' | 'self-hosted' | 'official-only' | 'mixed';
  requiresDedicatedServer?: boolean;
  releaseStatus: 'early-access' | 'released' | 'live-service' | 'maintenance-mode';
  releaseDate?: string;
  hasSinglePlayer: boolean;
  hasCoop: boolean;
  hasPvP: boolean;
  genre: string[];
}

export interface Person {
  id: string;
  displayName: string;
  stablePrefs: StablePrefs;
  weight?: number;
}

export interface GroupSettings {
  id: string;
  displayName: string;
  scoringWeights: {
    preferenceMatch: number;
    groupFit: number;
    sessionFit: number;
    novelty: number;
  };
  customCompletionGoals?: Record<string, string>;
  secretHash: string;
}

export interface SessionRecord {
  startedAt: string;
  attendees: string[];
  gamePicked: string;
  recommendationScore?: number;
  recommendedRank?: number;
  duration?: number;
  milestonesHit?: string[];
  notes?: string;
}

export interface RatingCacheEntry {
  avg: number;
  variance: number;
  n: number;
}

export type RatingCache = Record<VotedDim, RatingCacheEntry>;

export interface TonightInput {
  mood?: number;
  timeAvailableMins?: number | null;
  atTimestamp: string;
}

export type OwnsLookup = Record<string, Record<string, boolean>>;

export interface ScoredDimensionContribution {
  value: number;
  weight: number;
  contribution: number;
}

export interface ScoredGame {
  game: string;
  score: number;
  confidence: GameConfidence;
  maxVariance: number;
  breakdown: {
    preferenceMatch: ScoredDimensionContribution;
    groupFit: ScoredDimensionContribution;
    sessionFit: ScoredDimensionContribution;
    novelty: ScoredDimensionContribution;
  };
  flags: string[];
}

export interface RecommendationContext {
  group: GroupSettings;
  attendees: Person[];
  owns: OwnsLookup;
  tonight: { timeAvailableMins: number | null; mood: number | null };
  sessions: SessionRecord[];
  ratingCacheGroup: Record<string, RatingCache | undefined>;
  ratingCacheGlobal: Record<string, RatingCache | undefined>;
}

export interface RecommendationResponse {
  picks: ScoredGame[];
  alsoConsidered: ScoredGame[];
  excluded: { game: string; reason: string }[];
  context: {
    attendeeIds: string[];
    timeAvailableMins: number | null;
    weightsUsed: GroupSettings['scoringWeights'];
    candidatePoolSize: number;
  };
}
