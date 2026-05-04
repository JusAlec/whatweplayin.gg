import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import { fetchMe, signOut, type MeResponse } from '../lib/auth.js';

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string) ?? 'http://localhost:8787';

const PROVIDER_LABELS: Record<string, string> = {
  steam: 'Steam',
};

export default function MeSettings() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetchMe();
      if (!res) {
        window.location.href = '/signin';
        return;
      }
      setMe(res);
    } catch (e) {
      if (e instanceof AuthError) {
        window.location.href = '/signin';
        return;
      }
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function unlink(provider: string) {
    if (!confirm(`Unlink ${PROVIDER_LABELS[provider] ?? provider}?`)) return;
    setBusyProvider(provider);
    setError(null);
    try {
      await api.delete(`/api/me/links/${provider}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyProvider(null);
    }
  }

  if (!me) {
    return <p className="text-muted text-sm">Loading…</p>;
  }

  const hasEmail = me.user.email != null && me.user.email !== '';
  const linkedSteam = me.linkedAccounts.find((a) => a.provider === 'steam');
  // A user can only safely unlink an OAuth provider if there's another way
  // for them to sign in. Right now that means: an email is set, OR they
  // still have at least one other linked OAuth provider.
  const canUnlink = (provider: string) =>
    hasEmail || me.linkedAccounts.filter((a) => a.provider !== provider).length > 0;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <a href="/who" className="text-sm text-muted hover:text-text">
          ← Dashboard
        </a>
        <button
          onClick={() => void signOut()}
          className="text-sm text-muted underline hover:text-text"
        >
          Sign out
        </button>
      </header>

      <section className="flex items-center gap-4">
        {me.user.avatarUrl ? (
          <img
            src={me.user.avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full border border-border"
          />
        ) : (
          <div className="h-16 w-16 rounded-full border border-border bg-panel" />
        )}
        <div>
          <h1 className="text-2xl font-semibold">{me.user.displayName}</h1>
          {hasEmail ? (
            <p className="text-sm text-muted">{me.user.email}</p>
          ) : (
            <p className="text-sm text-muted">No email set</p>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Linked accounts</h2>
        <div className="divide-y divide-border rounded border border-border bg-panel">
          <div className="flex items-center justify-between gap-3 p-3">
            <div>
              <div className="text-sm font-medium">Steam</div>
              {linkedSteam ? (
                <div className="text-xs text-muted">
                  ID {linkedSteam.providerUserId}
                  {linkedSteam.providerData?.personaname
                    ? ` · ${linkedSteam.providerData.personaname}`
                    : ''}
                </div>
              ) : (
                <div className="text-xs text-muted">Not linked</div>
              )}
            </div>
            {linkedSteam ? (
              <button
                onClick={() => void unlink('steam')}
                disabled={busyProvider === 'steam' || !canUnlink('steam')}
                title={
                  !canUnlink('steam')
                    ? 'Set an email on your account before unlinking — otherwise you cannot sign back in.'
                    : undefined
                }
                className="shrink-0 rounded border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {busyProvider === 'steam' ? 'Unlinking…' : 'Unlink'}
              </button>
            ) : (
              <a
                href={`${WORKER_URL}/api/auth/link/steam`}
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white"
              >
                Link Steam
              </a>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
