import { useEffect, useState } from 'react';
import { api, AuthError } from '../lib/api-client.js';
import type { Group, GroupInvite, GroupMember } from '@wwp/auth-shared';
import { ArrowLeftIcon, RefreshIcon } from './icons.js';
import GameCard from './GameCard.js';
import { useConfig } from '../lib/useConfig.js';

interface Props {
  gid: string;
}

interface MemberWithUser extends GroupMember {
  displayName: string;
  avatarUrl: string | null;
}

interface GameSummary {
  id: string;
  name: string;
  coverUrl: string | null;
  steamReviewScoreDesc: string | null;
  steamReviewPctPositive: number | null;
  steamReviewCount: number | null;
  metadataSyncedAt: string | null;
  hasCoop: boolean;
  hasPvp: boolean;
  hasSingleplayer: boolean;
}

interface RecommendationPick {
  game: GameSummary;
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
  flags: string[];
}

interface RecommendationsResp {
  picks: RecommendationPick[];
  coldStart: boolean;
}

interface LibraryEntry {
  game: GameSummary;
  ownerCount: number;
  yourVote: -1 | 0 | 1;
  thumbs: { up: number; down: number };
}

interface LibraryResp {
  games: LibraryEntry[];
  total: number;
  limit: number;
  offset: number;
}

const LIBRARY_PAGE_SIZE = 24;
type LibraryFilter = 'all' | 'coop' | 'pvp' | 'single';

export default function GroupHomeMinimal({ gid }: Props) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [invites, setInvites] = useState<GroupInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<RecommendationsResp | null>(null);
  const [recsBusy, setRecsBusy] = useState(false);
  const [library, setLibrary] = useState<LibraryResp | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySearchInput, setLibrarySearchInput] = useState('');
  const [librarySearchActive, setLibrarySearchActive] = useState('');
  const { flags: featureFlags } = useConfig();

  async function load() {
    setError(null);
    try {
      const [detail, inv] = await Promise.all([
        api.get<{ group: Group; members: MemberWithUser[] }>(`/api/groups/${gid}`),
        api
          .get<{ invites: GroupInvite[] }>(`/api/groups/${gid}/invites`)
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
  }, [gid]);

  async function loadRecs() {
    setRecsBusy(true);
    try {
      const r = await api.get<RecommendationsResp>(`/api/groups/${gid}/recommendations`);
      setRecs(r);
    } catch (err) {
      console.error('recommendations fetch failed:', err);
    } finally {
      setRecsBusy(false);
    }
  }

  useEffect(() => {
    if (featureFlags.recommendations && group) {
      void loadRecs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureFlags.recommendations, group]);

  async function loadLibrary(opts: { offset?: number; filter?: LibraryFilter; q?: string } = {}) {
    const params = new URLSearchParams({
      limit: String(LIBRARY_PAGE_SIZE),
      offset: String(opts.offset ?? 0),
      filter: opts.filter ?? libraryFilter,
    });
    const q = opts.q ?? librarySearchActive;
    if (q) params.set('q', q);
    try {
      const r = await api.get<LibraryResp>(`/api/groups/${gid}/library?${params}`);
      setLibrary(r);
    } catch (err) {
      console.error('library fetch failed:', err);
    }
  }

  useEffect(() => {
    if (group) void loadLibrary({ offset: 0, filter: libraryFilter, q: librarySearchActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, libraryFilter, librarySearchActive]);

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      await api.post<{ code: string }>(`/api/groups/${gid}/invites`, {});
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
        <a
          href="/who"
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
          href="/who"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeftIcon /> All groups
        </a>
        <h1 className="text-2xl font-semibold">{group.displayName}</h1>
        <p className="text-xs text-muted">
          {members.length} member{members.length === 1 ? '' : 's'}
        </p>
      </header>

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

      {featureFlags.recommendations && (
        <section className="space-y-2">
          <header className="flex items-center gap-2">
            <h2 className="text-lg font-medium">Recommended tonight</h2>
            {recs?.coldStart && (
              <span className="text-xs font-normal text-muted">
                (using Steam ratings — vote thumbs to personalize)
              </span>
            )}
            <button
              onClick={() => void loadRecs()}
              disabled={recsBusy}
              aria-label="Refresh recommendations"
              title="Refresh recommendations"
              className="ml-auto rounded p-1 text-muted hover:bg-panel hover:text-text disabled:opacity-50"
            >
              <RefreshIcon />
            </button>
          </header>
          {recs === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : recs.picks.length === 0 ? (
            <p className="text-sm text-muted">
              No multiplayer games in your shared library yet. Have someone link Steam, or wait for
              thumb-down vetoes to lift.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recs.picks.map((p) => (
                <GameCard
                  key={p.game.id}
                  game={p.game}
                  groupId={gid}
                  ownerCount={p.ownerCount}
                  groupSize={p.groupSize}
                  thumbs={p.thumbs}
                  yourVote={p.yourVote}
                  flags={p.flags}
                  showThumbs={featureFlags.thumbs}
                  showRating={featureFlags.steamRatings}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Browse library</h2>
          <div className="flex flex-wrap gap-2">
            {(['all', 'coop', 'pvp', 'single'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setLibraryFilter(f)}
                className={`rounded border px-3 py-1 text-xs transition ${
                  libraryFilter === f
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-muted hover:border-accent hover:text-accent'
                }`}
              >
                {f === 'all' ? 'All' : f === 'coop' ? 'Co-op' : f === 'pvp' ? 'PvP' : 'Single'}
              </button>
            ))}
            <input
              value={librarySearchInput}
              onChange={(e) => setLibrarySearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setLibrarySearchActive(librarySearchInput);
              }}
              placeholder="Search…"
              className="rounded border border-border bg-panel px-2 py-1 text-xs"
            />
          </div>
        </header>
        {library === null ? (
          <p className="text-muted text-sm">Loading library…</p>
        ) : library.games.length === 0 ? (
          <p className="text-muted text-sm">No games match.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {library.games.map((entry) => (
                <GameCard
                  key={entry.game.id}
                  game={entry.game}
                  groupId={gid}
                  ownerCount={entry.ownerCount}
                  groupSize={members.length}
                  thumbs={entry.thumbs}
                  yourVote={entry.yourVote}
                  showThumbs={featureFlags.thumbs}
                  showRating={featureFlags.steamRatings}
                />
              ))}
            </div>
            {library.offset + library.games.length < library.total && (
              <button
                onClick={() => {
                  const newOffset = library.offset + library.limit;
                  void loadLibrary({ offset: newOffset });
                }}
                className="mt-4 w-full rounded border border-border py-2 text-sm text-muted hover:border-accent hover:text-accent"
              >
                Load more ({library.total - library.offset - library.games.length} remaining)
              </button>
            )}
          </>
        )}
      </section>

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
