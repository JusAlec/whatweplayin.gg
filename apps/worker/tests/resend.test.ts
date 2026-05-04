import { test, expect, describe, vi } from 'vitest';
import { sendMagicLinkEmail } from '../src/lib/resend.js';

// Simple fetch signature for the mock. The Worker fetch type is overloaded
// (Cloudflare's RequestInit<CfProperties> generic) which makes vi.fn typing
// ugly — this minimal alias keeps tests readable.
type SimpleFetchArgs = [
  url: string,
  init?: { method?: string; headers?: HeadersInit; body?: string },
];

describe('sendMagicLinkEmail', () => {
  test('POSTs to Resend API with the right shape', async () => {
    const fakeFetch = vi.fn<SimpleFetchArgs, Promise<Response>>(
      async () => new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );
    await sendMagicLinkEmail(
      'test_api_key',
      'a@b.co',
      'https://whatweplayin.gg/api/auth/callback/magic?token=abc',
      fakeFetch as unknown as typeof fetch,
    );
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test_api_key');
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(init?.body as string);
    expect(body.from).toContain('whatweplayin.gg');
    expect(body.to).toEqual(['a@b.co']);
    expect(body.subject).toMatch(/Sign in/i);
    expect(body.html).toContain('https://whatweplayin.gg/api/auth/callback/magic?token=abc');
  });

  test('throws on non-2xx response', async () => {
    const fakeFetch = vi.fn<SimpleFetchArgs, Promise<Response>>(
      async () => new Response('forbidden', { status: 403 }),
    );
    await expect(
      sendMagicLinkEmail('bad_key', 'a@b.co', 'https://x', fakeFetch as unknown as typeof fetch),
    ).rejects.toThrow();
  });
});
