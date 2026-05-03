import { checkAuth } from './auth.js';
import { dispatchKvCrud } from './routes/kv-crud.js';

export interface Env {
  KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (parts[0] === 'groups' && parts.length >= 2) {
      const groupId = parts[1]!;
      const authFail = await checkAuth(request, env, groupId);
      if (authFail) return withCors(authFail);

      const inner = parts.slice(2);
      const crudResponse = await dispatchKvCrud({ request, env, groupId, parts: inner });
      if (crudResponse) return withCors(crudResponse);

      return withCors(new Response('not found', { status: 404 }));
    }

    if (parts.length === 0) {
      return withCors(new Response('GameNight OS worker', { status: 200 }));
    }

    return withCors(new Response('not found', { status: 404 }));
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-group-secret',
    'access-control-max-age': '86400',
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v as string);
  return new Response(res.body, { status: res.status, headers });
}
