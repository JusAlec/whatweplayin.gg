import { api, AuthError } from './api-client.js';
import type { User } from '@wwp/auth-shared';

export interface MeResponse {
  user: User;
  linkedAccounts: Array<{
    provider: string;
    providerUserId: string;
    providerData: { personaname?: string; avatarfull?: string } | null;
  }>;
}

export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>('/api/me');
  } catch (e) {
    if (e instanceof AuthError) return null;
    throw e;
  }
}

export async function signOut(): Promise<void> {
  await api.post('/api/auth/logout', {});
  window.location.href = '/';
}
