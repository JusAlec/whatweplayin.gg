import { readAuth } from './auth.js';
import { enqueue, flush as flushPending } from './pending-writes.js';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL as string;

export class AuthError extends Error {}
export class NetworkError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = readAuth();
  if (!auth) throw new AuthError('not authenticated');
  try {
    const res = await fetch(`${WORKER_URL}/groups/${auth.groupId}${path}`, {
      method,
      headers: {
        'x-group-secret': auth.secret,
        ...(body != null ? { 'content-type': 'application/json' } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) throw new AuthError('forbidden');
    if (!res.ok) throw new Error(`worker ${res.status}: ${await res.text()}`);
    if (res.status === 200 && res.headers.get('content-type')?.includes('json')) {
      return (await res.json()) as T;
    }
    return undefined as T;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if ((method === 'PUT' || method === 'POST') && body !== undefined) {
      enqueue({ method: method as 'PUT' | 'POST', path, body });
      throw new NetworkError('queued for retry');
    }
    throw err;
  }
}

export const kv = {
  get: <T>(path: string) => call<T>('GET', path),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, body),
  post: <T>(path: string, body: unknown) => call<T>('POST', path, body),
  validate: async (groupId: string, secret: string): Promise<boolean> => {
    const res = await fetch(`${WORKER_URL}/groups/${groupId}/state`, {
      headers: { 'x-group-secret': secret },
    });
    return res.status !== 403;
  },
  flushPending: () =>
    flushPending(async (w) => {
      const auth = readAuth();
      if (!auth) return false;
      const res = await fetch(`${WORKER_URL}/groups/${auth.groupId}${w.path}`, {
        method: w.method,
        headers: { 'x-group-secret': auth.secret, 'content-type': 'application/json' },
        body: JSON.stringify(w.body),
      });
      return res.ok;
    }),
};
