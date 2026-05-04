import { test, expect, describe, beforeEach } from 'vitest';
// @ts-expect-error - cloudflare:test is provided by @cloudflare/vitest-pool-workers
import { env } from 'cloudflare:test';
import { generateMagicLinkToken, validateMagicLinkToken } from '../src/auth/magic-link.js';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM magic_link_tokens').run();
});

describe('generateMagicLinkToken', () => {
  test('inserts a row with 15-minute expiry and returns the token', async () => {
    const token = await generateMagicLinkToken(env.DB, 'a@b.co');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const row = await env.DB.prepare('SELECT * FROM magic_link_tokens WHERE token = ?')
      .bind(token)
      .first();
    expect(row?.email).toBe('a@b.co');
    expect(row?.used_at).toBeNull();
  });
});

describe('validateMagicLinkToken', () => {
  test('returns the email for a valid unused token', async () => {
    const token = await generateMagicLinkToken(env.DB, 'a@b.co');
    const result = await validateMagicLinkToken(env.DB, token);
    expect(result).toBe('a@b.co');
  });

  test('marks token as used after validation', async () => {
    const token = await generateMagicLinkToken(env.DB, 'a@b.co');
    await validateMagicLinkToken(env.DB, token);
    const row = await env.DB.prepare('SELECT used_at FROM magic_link_tokens WHERE token = ?')
      .bind(token)
      .first();
    expect(row?.used_at).not.toBeNull();
  });

  test('returns null for already-used token', async () => {
    const token = await generateMagicLinkToken(env.DB, 'a@b.co');
    await validateMagicLinkToken(env.DB, token);
    const result = await validateMagicLinkToken(env.DB, token);
    expect(result).toBeNull();
  });

  test('returns null for unknown token', async () => {
    const result = await validateMagicLinkToken(env.DB, 'a'.repeat(64));
    expect(result).toBeNull();
  });

  test('returns null for expired token', async () => {
    const token = 'expired-token-for-test'.padEnd(64, '0');
    await env.DB.prepare(
      'INSERT INTO magic_link_tokens (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(token, 'a@b.co', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')
      .run();
    const result = await validateMagicLinkToken(env.DB, token);
    expect(result).toBeNull();
  });
});
