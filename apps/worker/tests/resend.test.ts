import { test, expect, describe, vi } from 'vitest';
import { sendMagicLinkEmail } from '../src/lib/resend.js';

describe('sendMagicLinkEmail', () => {
  test('POSTs to Resend API with the right shape', async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );
    await sendMagicLinkEmail(
      'test_api_key',
      'a@b.co',
      'https://whatweplayin.gg/api/auth/callback/magic?token=abc',
      fakeFetch as typeof fetch,
    );
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).method).toBe('POST');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer test_api_key');
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.from).toContain('whatweplayin.gg');
    expect(body.to).toEqual(['a@b.co']);
    expect(body.subject).toMatch(/Sign in/i);
    expect(body.html).toContain('https://whatweplayin.gg/api/auth/callback/magic?token=abc');
  });

  test('throws on non-2xx response', async () => {
    const fakeFetch = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(
      sendMagicLinkEmail('bad_key', 'a@b.co', 'https://x', fakeFetch as typeof fetch),
    ).rejects.toThrow();
  });
});
