const HOSTING_MODELS = ['p2p', 'self-hosted', 'official-only', 'mixed'];
const RELEASE_STATUSES = ['early-access', 'released', 'live-service', 'maintenance-mode'];
const SLUG = /^[a-z0-9-]+$/;

export interface ValidationResult {
  errors: string[];
}

export function validateGame(game: unknown): ValidationResult {
  const errors: string[] = [];
  const g = game as Record<string, unknown>;

  if (typeof g.id !== 'string') errors.push('id: required string');
  else if (!SLUG.test(g.id)) errors.push('id: must match ^[a-z0-9-]+$');

  if (typeof g.name !== 'string' || g.name.length === 0) errors.push('name: required non-empty string');

  if (typeof g.minPlayers !== 'number') errors.push('minPlayers: required number');
  if (typeof g.maxPlayers !== 'number') errors.push('maxPlayers: required number');
  if (typeof g.minPlayers === 'number' && typeof g.maxPlayers === 'number') {
    if (g.minPlayers > g.maxPlayers) errors.push('minPlayers must be <= maxPlayers');
  }

  const op = g.optimalPlayers as { min?: number; max?: number } | undefined;
  if (!op || typeof op.min !== 'number' || typeof op.max !== 'number') {
    errors.push('optimalPlayers: required { min: number, max: number }');
  } else {
    if (op.min > op.max) errors.push('optimalPlayers.min must be <= optimalPlayers.max');
    if (typeof g.minPlayers === 'number' && op.min < g.minPlayers)
      errors.push('optimalPlayers.min must be >= minPlayers');
    if (typeof g.maxPlayers === 'number' && op.max > g.maxPlayers)
      errors.push('optimalPlayers.max must be <= maxPlayers');
  }

  if (!HOSTING_MODELS.includes(g.hostingModel as string))
    errors.push(`hostingModel: must be one of ${HOSTING_MODELS.join('|')}`);

  if (!RELEASE_STATUSES.includes(g.releaseStatus as string))
    errors.push(`releaseStatus: must be one of ${RELEASE_STATUSES.join('|')}`);

  for (const k of ['hasSinglePlayer', 'hasCoop', 'hasPvP'] as const) {
    if (typeof g[k] !== 'boolean') errors.push(`${k}: required boolean`);
  }

  if (!Array.isArray(g.genre) || g.genre.length === 0)
    errors.push('genre: required non-empty string array');

  return { errors };
}
