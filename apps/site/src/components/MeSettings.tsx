import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import { fetchMe, signOut, type MeResponse } from '../lib/auth.js';
import { ArrowLeftIcon, SignOutIcon } from './icons.js';

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string) ?? 'http://localhost:8787';

const PROVIDER_LABELS: Record<string, string> = {
  steam: 'Steam',
};

interface SyncResultBody {
  ok: boolean;
  gamesAdded: number;
  gamesUpdated: number;
  ownershipRemoved: number;
  unenrichedRemaining: number;
  syncedAt: string;
}

export default function MeSettings() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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

  async function refreshSteam() {
    setSyncBusy(true);
    setSyncMsg(null);
    try {
      const r = await api.post<SyncResultBody>('/api/me/sync/steam', {});
      const base = `Synced. +${r.gamesAdded} new, ${r.gamesUpdated} updated, -${r.ownershipRemoved} removed.`;
      const remainingNote =
        r.unenrichedRemaining > 0
          ? ` ${r.unenrichedRemaining} games still need metadata — click Refresh again to continue.`
          : '';
      setSyncMsg({ kind: 'success', text: base + remainingNote });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('steam-private') || msg.includes('422')) {
        setSyncMsg({
          kind: 'error',
          text: 'Steam profile is private. Open Privacy Settings → set Game Details to Public, then try again.',
        });
      } else {
        setSyncMsg({ kind: 'error', text: `Sync failed: ${msg}` });
      }
    } finally {
      setSyncBusy(false);
    }
  }

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
        <a
          href="/who"
          className="inline-flex items-center gap-1.5 rounded p-1 text-sm text-muted transition hover:text-text"
        >
          <ArrowLeftIcon /> Dashboard
        </a>
        <button
          onClick={() => void signOut()}
          aria-label="Sign out"
          title="Sign out"
          className="rounded p-2 text-muted transition hover:bg-bg hover:text-text"
        >
          <SignOutIcon />
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
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-3">
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
            {linkedSteam && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {me.user.steamLibrarySyncedAt
                    ? `Last synced: ${formatRelative(me.user.steamLibrarySyncedAt)}`
                    : 'Never synced'}
                </span>
                <button
                  onClick={() => void refreshSteam()}
                  disabled={syncBusy}
                  className="rounded border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {syncBusy ? 'Syncing…' : 'Refresh library'}
                </button>
              </div>
            )}
            {syncMsg && (
              <div
                className={`rounded border p-2 text-xs ${
                  syncMsg.kind === 'success'
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-danger/40 bg-danger/10 text-danger'
                }`}
              >
                {syncMsg.text}
                {syncMsg.kind === 'error' && syncMsg.text.includes('Privacy Settings') && (
                  <>
                    {' '}
                    <a
                      href="https://steamcommunity.com/my/edit/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Open Steam settings
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
