import { test, expect } from 'vitest';
import { validateGame } from '../lib/validate-game.js';

const validGame = {
  id: 'valheim',
  name: 'Valheim',
  minPlayers: 1,
  maxPlayers: 10,
  optimalPlayers: { min: 2, max: 5 },
  hostingModel: 'p2p',
  releaseStatus: 'released',
  hasSinglePlayer: true,
  hasCoop: true,
  hasPvP: false,
  genre: ['survival'],
};

test('valid game passes', () => {
  expect(validateGame(validGame).errors).toEqual([]);
});

test('missing id fails', () => {
  const bad = { ...validGame, id: undefined };
  expect(validateGame(bad).errors).toContain('id: required string');
});

test('id with non-slug chars fails', () => {
  const bad = { ...validGame, id: 'Valheim 1' };
  expect(validateGame(bad).errors).toContain('id: must match ^[a-z0-9-]+$');
});

test('minPlayers > maxPlayers fails', () => {
  const bad = { ...validGame, minPlayers: 5, maxPlayers: 4 };
  expect(validateGame(bad).errors).toContain('minPlayers must be <= maxPlayers');
});

test('optimalPlayers outside [min, max] fails', () => {
  const bad = { ...validGame, optimalPlayers: { min: 0, max: 11 } };
  expect(validateGame(bad).errors.some((e) => e.includes('optimalPlayers'))).toBe(true);
});

test('unknown hostingModel fails', () => {
  const bad = { ...validGame, hostingModel: 'cloud' };
  expect(validateGame(bad).errors).toContain(
    'hostingModel: must be one of p2p|self-hosted|official-only|mixed',
  );
});

test('unknown releaseStatus fails', () => {
  const bad = { ...validGame, releaseStatus: 'beta' };
  expect(validateGame(bad).errors).toContain(
    'releaseStatus: must be one of early-access|released|live-service|maintenance-mode',
  );
});
