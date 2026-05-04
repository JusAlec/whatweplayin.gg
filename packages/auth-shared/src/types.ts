import { z } from 'zod';

// User identity
export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  steamLibrarySyncedAt?: string | null;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

// OAuth account link (Steam in v2; more in v3)
export interface OAuthAccount {
  id: string;
  userId: string;
  provider: 'steam'; // open enum: add 'epic' | 'ea' | etc. in v3
  providerUserId: string;
  providerData: SteamProfile | null;
  createdAt: string;
}

export interface SteamProfile {
  personaname: string;
  profileurl: string;
  avatarfull: string;
  realname?: string;
}

// Groups
export interface Group {
  id: string;
  displayName: string;
  creatorId: string;
  scoringWeights: ScoringWeights;
  customCompletionGoals: Record<string, string> | null;
  createdAt: string;
  memberCount: number;
}

export interface ScoringWeights {
  preferenceMatch: number;
  groupFit: number;
  sessionFit: number;
  novelty: number;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: 'creator' | 'member';
  joinedAt: string;
  weight: number;
  stablePrefs: StablePrefs | null;
}

export interface StablePrefs {
  combat: number;
  grind: number;
  buildingDepth: number;
  commitmentLevel: number;
  pvpFocus: number;
  sessionLength: number;
}

export interface GroupInvite {
  code: string;
  groupId: string;
  createdBy: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdAt: string;
}

// Catalog
export interface Game {
  id: string;
  name: string;
  steamAppId: number | null;
  igdbId: number | null;
  description: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  minPlayers: number;
  maxPlayers: number;
  optimalMin: number | null;
  optimalMax: number | null;
  genres: string[];
  hasSinglePlayer: boolean;
  hasCoop: boolean;
  hasPvP: boolean;
  releaseStatus: 'early-access' | 'released' | 'live-service' | 'maintenance-mode';
  releaseDate: string | null;
  catalogTier: 'curated' | 'auto';
  metadataSyncedAt: string;
}

export interface GameOwnership {
  userId: string;
  gameId: string;
  source: 'steam' | 'manual';
  playtimeMinutes: number;
  lastPlayedAt: string | null;
  addedAt: string;
}

// API request/response shapes
export interface CreateGroupRequest {
  displayName: string;
  scoringWeights?: ScoringWeights;
}

export interface CreateInviteRequest {
  expiresInDays?: number; // default 7
  maxUses?: number; // default 0 (unlimited until expiry)
}

export interface AcceptInviteRequest {
  code: string;
}

export interface ThumbVoteRequest {
  groupId: string;
  gameId: string;
  sentiment: -1 | 0 | 1;
}

export interface DimVoteRequest {
  groupId: string;
  gameId: string;
  dim: 'combat' | 'grind' | 'buildingDepth' | 'commitmentLevel' | 'pvpFocus' | 'sessionLength';
  value: 1 | 2 | 3 | 4 | 5;
}

// === v2.1 additions ===

/** Game thumbs vote per (group, user, game). */
export interface Thumb {
  groupId: string;
  userId: string;
  gameId: string;
  vote: -1 | 1;
  votedAt: string;
}

/** Reasons a recommendation card might display caveats. */
export type GameFlag = 'cold-start' | 'low-confidence' | 'not-enriched' | 'never-played';

/** Game extended with v2.1 catalog metadata. Steam review fields NULL until enriched. */
export interface GameV21 extends Game {
  steamReviewScore: number | null;
  steamReviewScoreDesc: string | null;
  steamReviewPctPositive: number | null;
  steamReviewCount: number | null;
}

/** Game enriched with group-relative context (for recommender + UI). */
export interface EnrichedGame extends GameV21 {
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
  flags: GameFlag[];
}

/** Recommender output (one entry per pick). */
export interface RankedPick {
  game: GameV21;
  score: number;
  breakdown: { thumbs: number; ownership: number; novelty: number };
  flags: GameFlag[];
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
}

export interface RecommendationsResponse {
  picks: RankedPick[];
  generatedAt: string;
  weightsUsed: { thumbs: number; ownership: number; novelty: number };
  coldStart: boolean;
}

export interface LibraryEntry {
  game: GameV21;
  ownerCount: number;
  yourVote: -1 | 0 | 1;
  thumbs: { up: number; down: number };
  yourPlaytime: number | null;
  yourLastPlayed: string | null;
}

export interface LibraryResponse {
  games: LibraryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface SyncResult {
  gamesAdded: number;
  gamesUpdated: number;
  ownershipRemoved: number;
  enrichmentDeferred: number;
  syncedAt: string;
}

export interface FeatureFlags {
  autosyncOnLogin: boolean;
  thumbs: boolean;
  recommendations: boolean;
  steamRatings: boolean;
}

export interface ConfigResponse {
  flags: FeatureFlags;
}

/** Request body for PUT /api/groups/:gid/games/:gameId/thumb */
export const ThumbVoteRequestV21Schema = z.object({
  vote: z.union([z.literal(-1), z.literal(1)]),
});
export type ThumbVoteRequestV21 = z.infer<typeof ThumbVoteRequestV21Schema>;
