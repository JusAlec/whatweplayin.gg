import { test, expect, describe } from 'vitest';
import {
  CreateGroupRequestSchema,
  CreateInviteRequestSchema,
  ThumbVoteRequestSchema,
  DimVoteRequestSchema,
  StablePrefsSchema,
  ScoringWeightsSchema,
} from '../src/schemas.js';

describe('CreateGroupRequestSchema', () => {
  test('accepts valid request', () => {
    const r = CreateGroupRequestSchema.safeParse({ displayName: 'RIVALS' });
    expect(r.success).toBe(true);
  });

  test('rejects empty displayName', () => {
    const r = CreateGroupRequestSchema.safeParse({ displayName: '' });
    expect(r.success).toBe(false);
  });

  test('rejects displayName over 50 chars', () => {
    const r = CreateGroupRequestSchema.safeParse({ displayName: 'a'.repeat(51) });
    expect(r.success).toBe(false);
  });

  test('accepts custom scoringWeights that sum to 1.0', () => {
    const r = CreateGroupRequestSchema.safeParse({
      displayName: 'g',
      scoringWeights: { preferenceMatch: 0.5, groupFit: 0.2, sessionFit: 0.2, novelty: 0.1 },
    });
    expect(r.success).toBe(true);
  });

  test('rejects scoringWeights that do not sum to 1.0', () => {
    const r = CreateGroupRequestSchema.safeParse({
      displayName: 'g',
      scoringWeights: { preferenceMatch: 0.5, groupFit: 0.2, sessionFit: 0.2, novelty: 0.5 },
    });
    expect(r.success).toBe(false);
  });
});

describe('CreateInviteRequestSchema', () => {
  test('accepts empty body (uses defaults)', () => {
    const r = CreateInviteRequestSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  test('rejects expiresInDays > 30', () => {
    const r = CreateInviteRequestSchema.safeParse({ expiresInDays: 31 });
    expect(r.success).toBe(false);
  });

  test('rejects negative maxUses', () => {
    const r = CreateInviteRequestSchema.safeParse({ maxUses: -1 });
    expect(r.success).toBe(false);
  });
});

describe('ThumbVoteRequestSchema', () => {
  test.each([-1, 0, 1])('accepts sentiment %i', (s) => {
    const r = ThumbVoteRequestSchema.safeParse({ groupId: 'g', gameId: 'valheim', sentiment: s });
    expect(r.success).toBe(true);
  });

  test('rejects sentiment 2', () => {
    const r = ThumbVoteRequestSchema.safeParse({ groupId: 'g', gameId: 'valheim', sentiment: 2 });
    expect(r.success).toBe(false);
  });
});

describe('DimVoteRequestSchema', () => {
  test('accepts valid dim + value', () => {
    const r = DimVoteRequestSchema.safeParse({
      groupId: 'g',
      gameId: 'v',
      dim: 'combat',
      value: 3,
    });
    expect(r.success).toBe(true);
  });

  test('rejects unknown dim', () => {
    const r = DimVoteRequestSchema.safeParse({
      groupId: 'g',
      gameId: 'v',
      dim: 'teamwork',
      value: 3,
    });
    expect(r.success).toBe(false);
  });

  test('rejects value 6', () => {
    const r = DimVoteRequestSchema.safeParse({
      groupId: 'g',
      gameId: 'v',
      dim: 'combat',
      value: 6,
    });
    expect(r.success).toBe(false);
  });
});

describe('StablePrefsSchema', () => {
  test('accepts all 6 dims at value 3', () => {
    const r = StablePrefsSchema.safeParse({
      combat: 3,
      grind: 3,
      buildingDepth: 3,
      commitmentLevel: 3,
      pvpFocus: 3,
      sessionLength: 3,
    });
    expect(r.success).toBe(true);
  });

  test('rejects missing dim', () => {
    const r = StablePrefsSchema.safeParse({
      combat: 3,
      grind: 3,
      buildingDepth: 3,
      commitmentLevel: 3,
      pvpFocus: 3,
    });
    expect(r.success).toBe(false);
  });
});

describe('ScoringWeightsSchema', () => {
  test('accepts default v1 weights', () => {
    const r = ScoringWeightsSchema.safeParse({
      preferenceMatch: 0.4,
      groupFit: 0.25,
      sessionFit: 0.2,
      novelty: 0.15,
    });
    expect(r.success).toBe(true);
  });

  test('accepts ±0.001 sum tolerance', () => {
    const r = ScoringWeightsSchema.safeParse({
      preferenceMatch: 0.4,
      groupFit: 0.25,
      sessionFit: 0.2,
      novelty: 0.15001,
    });
    expect(r.success).toBe(true);
  });

  test('rejects sum 0.95', () => {
    const r = ScoringWeightsSchema.safeParse({
      preferenceMatch: 0.35,
      groupFit: 0.25,
      sessionFit: 0.2,
      novelty: 0.15,
    });
    expect(r.success).toBe(false);
  });
});
