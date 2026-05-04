import type { Env } from '../index.js';

/** True ONLY when the env var equals the literal string "true". Default: false (test-safe). */
export function flagOn(env: Env, key: keyof Env): boolean {
  return env[key] === 'true';
}

/** True ONLY when the env var equals the literal string "false". Default: not-disabled (lets routes default to enabled). */
export function flagOff(env: Env, key: keyof Env): boolean {
  return env[key] === 'false';
}

/** Parse a numeric env var, falling back if unset/empty/non-numeric. */
export function readNumber(env: Env, key: keyof Env, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== 'string' || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
