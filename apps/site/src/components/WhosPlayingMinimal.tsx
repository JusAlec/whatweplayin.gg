import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import { fetchMe, signOut, type MeResponse } from '../lib/auth.js';
import { CloseIcon, PlusIcon, SettingsIcon, SignOutIcon } from './icons.js';

type AddMode = 'idle' | 'create' | 'join';

const WORKER_URL = (import.meta.env.PUBLIC_WORKER_URL as string) ?? 'http://localhost:8787';

interface GroupSummary {
  id: string;
  displayName: string;
  role: string;
  createdAt: string;
}

type LinkBanner = { kind: 'success'; text: string } | { kind: 'error'; text: string } | null;

export default function WhosPlayingMinimal() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkBanner, setLinkBanner] = useState<LinkBanner>(null);
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('idle');

  function resetAdd() {
    setAddMode('idle');
    setCreateName('');
    setJoinCode('');
  }

  async function load() {
    setError(null);
    try {
      const [meRes, groupsRes] = await Promise.all([
        fetchMe(),
        api.get<{ groups: GroupSummary[] }>('/api/groups'),
      ]);
      if (!meRes) {
        window.location.href = '/signin';
        return;
      }
      setMe(meRes);
      setGroups(groupsRes.groups);
    } catch (e) {
      if (e instanceof AuthError) {
        window.location.href = '/signin';
        return;
      }
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    // Resume a pending invite the user stashed before sign-in. This is what
    // turns a freshly-signed-in friend into a group member without the
    // "go back, find the invite link, paste it again" friction.
    const pendingInvite = sessionStorage.getItem('wwp:pendingInvite');
    if (pendingInvite) {
      sessionStorage.removeItem('wwp:pendingInvite');
      window.location.replace(`/invite/${encodeURIComponent(pendingInvite)}`);
      return;
    }

    // Surface link results from the Steam-link callback round trip.
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') === 'steam') {
      setLinkBanner({ kind: 'success', text: 'Steam account linked.' });
    } else if (params.get('linkError') === 'steam-already-linked') {
      setLinkBanner({
        kind: 'error',
        text: 'That Steam account is already linked to a different user.',
      });
    }
    if (params.has('linked') || params.has('linkError')) {
      // Strip the query params from the URL without reloading.
      window.history.replaceState({}, '', window.location.pathname);
    }
    load();
  }, []);

  // Auto-dismiss success banners after 5s; keep error banners until the user
  // dismisses them (so they don't miss the message).
  useEffect(() => {
    if (linkBanner?.kind !== 'success') return;
    const id = window.setTimeout(() => setLinkBanner(null), 5000);
    return () => window.clearTimeout(id);
  }, [linkBanner]);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.post<{ id: string }>('/api/groups', {
        displayName: createName.trim(),
      });
      window.location.href = `/groups/${g.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function joinGroup(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ groupId: string }>('/api/invites/accept', { code });
      window.location.href = `/groups/${res.groupId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const steamLinked = me?.linkedAccounts.some((a) => a.provider === 'steam') ?? false;
  const greeting = me ? `Hi, ${me.user.displayName}` : 'Loading…';

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {me?.user.avatarUrl ? (
            <img
              src={me.user.avatarUrl}
              alt=""
              className="h-10 w-10 rounded-full border border-border"
            />
          ) : null}
          <h1 className="text-2xl font-semibold">{greeting}</h1>
        </div>
        <div className="flex items-center gap-1">
          <a
            href="/me"
            aria-label="Settings"
            title="Settings"
            className="rounded p-2 text-muted transition hover:bg-panel hover:text-text"
          >
            <SettingsIcon />
          </a>
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="rounded p-2 text-muted transition hover:bg-panel hover:text-text"
          >
            <SignOutIcon />
          </button>
        </div>
      </header>

      {linkBanner && (
        <div
          className={`flex items-start justify-between gap-3 rounded border p-3 text-sm ${
            linkBanner.kind === 'success'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          <span>{linkBanner.text}</span>
          <button
            type="button"
            onClick={() => setLinkBanner(null)}
            aria-label="Dismiss"
            className="shrink-0 px-1 leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {me && !steamLinked && (
        <section className="rounded border border-border bg-panel p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Link your Steam account</div>
              <div className="text-xs text-muted">Used in v2.1 to auto-import your library.</div>
            </div>
            <a
              href={`${WORKER_URL}/api/auth/link/steam`}
              className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-semibold text-white"
            >
              Link Steam
            </a>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section>
        <header className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your groups</h2>
          <button
            type="button"
            onClick={() => (addMode === 'idle' ? setAddMode('create') : resetAdd())}
            aria-label={addMode === 'idle' ? 'Add a group' : 'Close'}
            title={addMode === 'idle' ? 'Add a group' : 'Close'}
            className="rounded p-2 text-muted transition hover:bg-panel hover:text-text"
          >
            {addMode === 'idle' ? <PlusIcon /> : <CloseIcon />}
          </button>
        </header>

        {addMode !== 'idle' && (
          <div className="mb-3 space-y-3 rounded border border-border bg-panel p-3">
            <div className="flex gap-1 rounded bg-bg p-1 text-sm">
              <button
                type="button"
                onClick={() => setAddMode('create')}
                className={`flex-1 rounded px-3 py-1.5 transition ${
                  addMode === 'create'
                    ? 'bg-accent font-medium text-white'
                    : 'text-muted hover:text-text'
                }`}
              >
                Create new group
              </button>
              <button
                type="button"
                onClick={() => setAddMode('join')}
                className={`flex-1 rounded px-3 py-1.5 transition ${
                  addMode === 'join'
                    ? 'bg-accent font-medium text-white'
                    : 'text-muted hover:text-text'
                }`}
              >
                Join with code
              </button>
            </div>

            {addMode === 'create' ? (
              <form onSubmit={createGroup} className="flex gap-2">
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Group name"
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2"
                  disabled={busy}
                  autoFocus
                  key="create-input"
                />
                <button
                  type="submit"
                  disabled={busy || !createName.trim()}
                  className="shrink-0 rounded bg-accent px-4 py-2 text-white disabled:opacity-60"
                >
                  Create
                </button>
              </form>
            ) : (
              <form onSubmit={joinGroup} className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Invite code"
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 font-mono"
                  disabled={busy}
                  autoFocus
                  key="join-input"
                />
                <button
                  type="submit"
                  disabled={busy || !joinCode.trim()}
                  className="shrink-0 rounded bg-accent px-4 py-2 text-white disabled:opacity-60"
                >
                  Join
                </button>
              </form>
            )}
          </div>
        )}

        {groups === null ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-muted text-sm">No groups yet. Tap + to create or join one.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id}>
                <a
                  href={`/groups/${g.id}`}
                  className="block rounded border border-border bg-panel p-3 hover:border-accent"
                >
                  <div className="font-medium">{g.displayName}</div>
                  <div className="text-xs text-muted">{g.role}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
