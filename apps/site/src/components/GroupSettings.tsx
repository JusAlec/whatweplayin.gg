import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import type { Group, GroupInvite, GroupMember } from '@wwp/auth-shared';
import { ArrowLeftIcon } from './icons.js';

interface MemberWithUser extends GroupMember {
  displayName: string;
  avatarUrl: string | null;
}

interface GroupSettingsProps {
  groupId: string;
}

export default function GroupSettings({ groupId }: GroupSettingsProps) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [invites, setInvites] = useState<GroupInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const [detail, inv] = await Promise.all([
        api.get<{ group: Group; members: MemberWithUser[] }>(`/api/groups/${groupId}`),
        api
          .get<{ invites: GroupInvite[] }>(`/api/groups/${groupId}/invites`)
          .catch(() => ({ invites: [] as GroupInvite[] })),
      ]);
      setGroup(detail.group);
      setMembers(detail.members);
      setInvites(inv.invites);
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
  }, [groupId]);

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      await api.post<{ code: string }>(`/api/groups/${groupId}/invites`, {});
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
      await api.post(`/api/groups/${groupId}/leave`, {});
      window.location.href = '/who';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <a
          href={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeftIcon /> Back
        </a>
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
        <a
          href={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeftIcon /> {group.displayName}
        </a>
        <h1 className="text-2xl font-semibold">Group settings</h1>
        <p className="text-xs text-muted">
          {members.length} member{members.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* Members */}
      <section className="space-y-2">
        <h2 className="text-sm uppercase text-muted">Members</h2>
        <ul className="divide-y divide-border rounded bg-panel">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 p-3 text-sm">
              {m.avatarUrl ? (
                <img
                  src={m.avatarUrl}
                  alt=""
                  className="h-8 w-8 rounded-full border border-border"
                />
              ) : (
                <div className="h-8 w-8 rounded-full border border-border bg-bg" />
              )}
              <span className="flex-1 font-medium">{m.displayName}</span>
              <span className="text-xs text-muted">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Invites */}
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
                <li key={inv.code} className="rounded border border-border bg-panel p-3 text-sm">
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

      {/* Danger zone */}
      <section className="space-y-2">
        <h2 className="text-sm uppercase text-muted">Danger zone</h2>
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
