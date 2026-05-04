import { betterAuth } from 'better-auth';
import type { Env } from '../index.js';

/**
 * Returns a Better Auth instance scoped to the request's D1 binding.
 * Called per-request because D1 binding lives on env, not module scope.
 */
export function createAuth(env: Env) {
  return betterAuth({
    database: {
      provider: 'd1',
      db: env.DB,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? 'https://whatweplayin.gg',
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh once per day
    },
    emailAndPassword: { enabled: false }, // we use magic link instead
    plugins: [
      // Steam OpenID + magic link plugins added in Tasks 14, 16
    ],
    advanced: {
      cookiePrefix: 'wwp',
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
