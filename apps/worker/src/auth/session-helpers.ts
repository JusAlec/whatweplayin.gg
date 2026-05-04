import { ulid } from 'ulid';
import { Db } from '../lib/d1-client.js';
import type { Session, User } from '@wwp/auth-shared';

const COOKIE_NAME = 'wwp_session';
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export async function createSessionForUser(db: D1Database, userId: string): Promise<string> {
  const id = ulid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await new Db(db).sessions.insert({
    id,
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });
  return id;
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === name && v) return v;
  }
  return null;
}

export async function getSessionFromRequest(
  db: D1Database,
  req: Request,
): Promise<{ session: Session; user: User } | null> {
  const sessionId = parseCookie(req.headers.get('cookie'), COOKIE_NAME);
  if (!sessionId) return null;

  const dbi = new Db(db);
  const session = await dbi.sessions.getById(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  const user = await dbi.users.getById(session.userId);
  if (!user) return null;

  return { session, user };
}

export interface CookieOptions {
  domain?: string;
}

export function sessionCookie(sessionId: string, opts?: CookieOptions): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const domain = opts?.domain ? `; Domain=${opts.domain}` : '';
  return `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}${domain}`;
}

export function clearSessionCookie(opts?: CookieOptions): string {
  const domain = opts?.domain ? `; Domain=${opts.domain}` : '';
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0${domain}`;
}
