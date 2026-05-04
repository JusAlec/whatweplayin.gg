const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL as string;

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body != null ? { 'content-type': 'application/json' } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError('not authenticated');
  if (!res.ok) throw new ApiError(res.status, await res.text());
  if (res.headers.get('content-type')?.includes('json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body: unknown) => call<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  delete: <T>(path: string) => call<T>('DELETE', path),
};
