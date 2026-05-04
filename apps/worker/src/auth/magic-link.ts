const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateMagicLinkToken(db: D1Database, email: string): Promise<string> {
  const token = randomHex(32); // 64-char hex
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  await db
    .prepare(
      'INSERT INTO magic_link_tokens (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(token, email, expiresAt.toISOString(), now.toISOString())
    .run();
  return token;
}

export async function validateMagicLinkToken(
  db: D1Database,
  token: string,
): Promise<string | null> {
  const row = (await db
    .prepare('SELECT email, expires_at, used_at FROM magic_link_tokens WHERE token = ?')
    .bind(token)
    .first()) as { email?: string; expires_at?: string; used_at?: string | null } | null;

  if (!row) return null;
  if (row.used_at != null) return null;
  if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) return null;

  await db
    .prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token = ?')
    .bind(new Date().toISOString(), token)
    .run();

  return row.email ?? null;
}
