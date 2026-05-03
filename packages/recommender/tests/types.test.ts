import { test, expect } from 'vitest';
import { VOTED_DIMS } from '../src/types.js';

test('VOTED_DIMS contains the 6 vote dimensions in spec order', () => {
  expect(VOTED_DIMS).toEqual([
    'combat', 'grind', 'buildingDepth', 'commitmentLevel', 'pvpFocus', 'sessionLength',
  ]);
});
