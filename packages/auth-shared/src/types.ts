// User identity
export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
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
