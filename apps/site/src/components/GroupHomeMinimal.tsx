import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import type { Group, GroupInvite } from '@wwp/auth-shared';

interface Props {
  gid: string;
}

export default function GroupHomeMinimal({ gid }: Props) {
  const [group, setGroup] = useState<Group | null>(null);
  const [invites, setInvites] = useState<GroupInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const [g, inv] = await Promise.all([
        api.get<Group>(`/api/groups/${gid}`),
        api.get<GroupInvite[]>(`/api/groups/${gid}/invites`).catch(() => [] as GroupInvite[]),
      ]);
      setGroup(g);
      setInvites(inv);
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
  }, [gid]);

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      await api.post<GroupInvite>(`/api/groups/${gid}/invites`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leaveGroup() {
    if (!confirm('Leave this group?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/groups/${gid}/leave`, {});
      window.location.href = '/who';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <a href="/who" className="text-sm text-muted hover:text-text">← Back</a>
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      </div>
    );
  }

  if (!group) {
    return <p className="text-muted text-sm">Loading…</p>;
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <a href="/who" className="text-sm text-muted hover:text-text">← All groups</a>
        <h1 className="text-2xl font-semibold">{group.displayName}</h1>
        <p className="text-xs text-muted">
          {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Invites</h2>
          <button
            onClick={createInvite}
            disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            New invite
          </button>
        </div>
        {invites === null ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-muted text-sm">No active invites.</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => {
              const url = `${origin}/invite/${inv.code}`;
              return (
                <li
                  key={inv.code}
                  className="rounded border border-border bg-panel p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="break-all text-xs">{url}</code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(url)}
                      className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:border-accent"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Uses: {inv.useCount}
                    {inv.maxUses > 0 ? ` / ${inv.maxUses}` : ''} · Expires{' '}
                    {new Date(inv.expiresAt).toLocaleString()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <button
          onClick={leaveGroup}
          disabled={busy}
          className="rounded border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
        >
          Leave group
        </button>
      </section>
    </div>
  );
}
