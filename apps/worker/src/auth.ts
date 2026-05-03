import type { Env } from './index.js';

export async function checkAuth(
  request: Request,
  env: Env,
  groupId: string,
): Promise<Response | null> {
  const secret = request.headers.get('x-group-secret');
  if (!secret) return new Response('forbidden', { status: 403 });
  const expected = await env.KV.get(`group:${groupId}:secret`);
  if (!expected || expected !== secret) return new Response('forbidden', { status: 403 });
  return null;
}
