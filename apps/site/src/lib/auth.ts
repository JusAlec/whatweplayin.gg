const STORAGE_KEY = 'gno:auth';

export interface AuthState {
  groupId: string;
  secret: string;
}

export function readAuth(): AuthState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return readAuthFromHash();
  try {
    const parsed = JSON.parse(raw) as AuthState;
    if (!parsed.groupId || !parsed.secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAuth(state: AuthState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

function readAuthFromHash(): AuthState | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const g = params.get('g');
  const s = params.get('s');
  if (g && s) {
    const state = { groupId: g, secret: s };
    writeAuth(state);
    history.replaceState(null, '', window.location.pathname);
    return state;
  }
  return null;
}
