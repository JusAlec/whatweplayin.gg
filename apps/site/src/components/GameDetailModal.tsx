import { useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';
import type { GameDetailResponse } from '@wwp/auth-shared';
import { CloseIcon, ThumbUpIcon, ThumbDownIcon } from './icons.js';

interface GameDetailModalProps {
  gameId: string | null;
  groupId: string;
  onClose: () => void;
}

const IGDB_HERO_BASE = 'https://images.igdb.com/igdb/image/upload/t_1080p';

export function GameDetailModal({ gameId, groupId, onClose }: GameDetailModalProps) {
  const [data, setData] = useState<GameDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    setData(null);
    setError(null);
    let alive = true;
    (async () => {
      try {
        const r = await api.get<GameDetailResponse>(`/api/games/${gameId}?groupId=${groupId}`);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, groupId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (gameId) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [gameId, onClose]);

  async function vote(v: 1 | -1) {
    if (!data) return;
    setVoting(true);
    try {
      const isToggleOff = data.groupContext.yourVote === v;
      if (isToggleOff) {
        await api.delete(`/api/groups/${groupId}/games/${data.game.id}/thumb`);
      } else {
        await api.put(`/api/groups/${groupId}/games/${data.game.id}/thumb`, { vote: v });
      }
      // Optimistic refetch
      const r = await api.get<GameDetailResponse>(`/api/games/${data.game.id}?groupId=${groupId}`);
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVoting(false);
    }
  }

  if (!gameId) return null;

  const backdrop = data?.game.igdbScreenshotId
    ? `${IGDB_HERO_BASE}/${data.game.igdbScreenshotId}.jpg`
    : (data?.game.coverUrl ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        {!data && !error && <div className="p-8 text-center text-muted">Loading…</div>}
        {error && <div className="p-8 text-center text-danger">Failed to load: {error}</div>}
        {data && (
          <>
            <div className="relative h-64 w-full overflow-hidden">
              {backdrop ? (
                <img
                  src={backdrop}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-bg" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <h2 className="text-2xl font-bold text-white">{data.game.name}</h2>
                {data.game.genres && data.game.genres.length > 0 && (
                  <p className="text-xs text-white/70">{data.game.genres.join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4">
              {data.game.description && (
                <p className="text-sm text-text">{data.game.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>
                  Owned by {data.groupContext.ownerCount}/{data.groupContext.groupSize}
                </span>
                {data.game.optimalMin != null && data.game.optimalMax != null && (
                  <span>
                    Optimal {data.game.optimalMin}–{data.game.optimalMax} players
                  </span>
                )}
                {data.game.steamReviewPctPositive != null && (
                  <span>{data.game.steamReviewPctPositive}% positive on Steam</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => vote(1)}
                  aria-label="Thumbs up"
                  className={`rounded border p-2 transition ${
                    data.groupContext.yourVote === 1
                      ? 'border-success bg-success/20 text-success'
                      : 'border-border text-muted hover:text-text'
                  }`}
                >
                  <ThumbUpIcon />{' '}
                  <span className="ml-1 text-xs">{data.groupContext.thumbs.up}</span>
                </button>
                <button
                  type="button"
                  disabled={voting}
                  onClick={() => vote(-1)}
                  aria-label="Thumbs down"
                  className={`rounded border p-2 transition ${
                    data.groupContext.yourVote === -1
                      ? 'border-danger bg-danger/20 text-danger'
                      : 'border-border text-muted hover:text-text'
                  }`}
                >
                  <ThumbDownIcon />{' '}
                  <span className="ml-1 text-xs">{data.groupContext.thumbs.down}</span>
                </button>
              </div>

              {data.groupContext.members.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Who owns it</h3>
                  <ul className="space-y-1 text-xs">
                    {data.groupContext.members.map((m) => (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-2 rounded bg-bg p-2"
                      >
                        <span className="flex items-center gap-2">
                          {m.avatarUrl ? (
                            <img src={m.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-border" />
                          )}
                          <span>{m.displayName}</span>
                        </span>
                        <span className="text-muted">
                          {Math.round(m.playtime / 60)}h
                          {m.lastPlayed
                            ? ` · last ${new Date(m.lastPlayed).toLocaleDateString()}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
