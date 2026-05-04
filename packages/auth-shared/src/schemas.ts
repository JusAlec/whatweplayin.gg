import { z } from 'zod';

export const StablePrefsSchema = z.object({
  combat: z.number().int().min(1).max(5),
  grind: z.number().int().min(1).max(5),
  buildingDepth: z.number().int().min(1).max(5),
  commitmentLevel: z.number().int().min(1).max(5),
  pvpFocus: z.number().int().min(1).max(5),
  sessionLength: z.number().int().min(1).max(5),
});

export const ScoringWeightsSchema = z
  .object({
    preferenceMatch: z.number().min(0).max(1),
    groupFit: z.number().min(0).max(1),
    sessionFit: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(w.preferenceMatch + w.groupFit + w.sessionFit + w.novelty - 1) <= 0.001, {
    message: 'scoringWeights must sum to 1.0 (±0.001)',
  });

export const CreateGroupRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  scoringWeights: ScoringWeightsSchema.optional(),
});

export const CreateInviteRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional(),
  maxUses: z.number().int().min(0).optional(),
});

export const AcceptInviteRequestSchema = z.object({
  code: z.string().regex(/^[a-zA-Z0-9]{8}$/),
});

const VOTED_DIMS = [
  'combat',
  'grind',
  'buildingDepth',
  'commitmentLevel',
  'pvpFocus',
  'sessionLength',
] as const;

export const ThumbVoteRequestSchema = z.object({
  groupId: z.string().min(1),
  gameId: z.string().min(1),
  sentiment: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export const DimVoteRequestSchema = z.object({
  groupId: z.string().min(1),
  gameId: z.string().min(1),
  dim: z.enum(VOTED_DIMS),
  value: z.number().int().min(1).max(5),
});
