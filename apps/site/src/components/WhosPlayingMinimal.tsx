import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import type { Group } from '@wwp/auth-shared';

export default function WhosPlayingMinimal() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const list = await api.get<Group[]>('/api/groups');
      setGroups(list);
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

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.post<Group>('/api/groups', { displayName: createName.trim() });
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

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your groups</h1>
        <a href="/signin" className="text-sm text-muted hover:text-text">
          Sign out
        </a>
      </header>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section>
        {groups === null ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-muted text-sm">No groups yet. Create or join one below.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id}>
                <a
                  href={`/groups/${g.id}`}
                  className="block rounded border border-border bg-panel p-3 hover:border-accent"
                >
                  <div className="font-medium">{g.displayName}</div>
                  <div className="text-xs text-muted">
                    {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Create a group</h2>
        <form onSubmit={createGroup} className="flex gap-2">
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Group name"
            className="flex-1 rounded border border-border bg-panel px-3 py-2"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !createName.trim()}
            className="rounded bg-accent px-4 py-2 text-white disabled:opacity-60"
          >
            Create
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Join with invite code</h2>
        <form onSubmit={joinGroup} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Invite code"
            className="flex-1 rounded border border-border bg-panel px-3 py-2"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !joinCode.trim()}
            className="rounded bg-accent px-4 py-2 text-white disabled:opacity-60"
          >
            Join
          </button>
        </form>
      </section>
    </div>
  );
}
