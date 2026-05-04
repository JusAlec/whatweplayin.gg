import { useState } from 'react';
import { api } from '../lib/api-client.js';
import { ThumbUpIcon, ThumbDownIcon } from './icons.js';

interface GameSummary {
  id: string;
  name: string;
  coverUrl: string | null;
  steamReviewScoreDesc: string | null;
  steamReviewPctPositive: number | null;
  steamReviewCount: number | null;
  metadataSyncedAt: string | null;
}

export interface GameCardProps {
  game: GameSummary;
  groupId: string;
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
  flags?: string[];
  showThumbs?: boolean;
  showRating?: boolean;
}

export default function GameCard({
  game,
  groupId,
  ownerCount,
  groupSize,
  thumbs,
  yourVote,
  flags = [],
  showThumbs = true,
  showRating = true,
}: GameCardProps) {
  const [vote, setVote] = useState<-1 | 0 | 1>(yourVote);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState(thumbs);
  const notEnriched = flags.includes('not-enriched') || !game.metadataSyncedAt;
  const lowConfidence = flags.includes('low-confidence');

  async function setVoteAndPersist(newVote: 1 | -1) {
    if (busy) return;
    const optimistic = vote === newVote ? 0 : newVote;
    const prevVote = vote;
    const prevCounts = counts;

    setVote(optimistic);
    setCounts(({ up, down }) => {
      let nextUp = up;
      let nextDown = down;
      if (prevVote === 1) nextUp -= 1;
      if (prevVote === -1) nextDown -= 1;
      if (optimistic === 1) nextUp += 1;
      if (optimistic === -1) nextDown += 1;
      return { up: nextUp, down: nextDown };
    });

    setBusy(true);
    try {
      if (optimistic === 0) {
        await api.delete(`/api/groups/${groupId}/games/${game.id}/thumb`);
      } else {
        await api.put(`/api/groups/${groupId}/games/${game.id}/thumb`, { vote: optimistic });
      }
    } catch (err) {
      setVote(prevVote);
      setCounts(prevCounts);
      console.error('thumb vote failed:', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-48 shrink-0 flex-col gap-2 rounded border border-border bg-panel p-2">
      <div className="aspect-video w-full overflow-hidden rounded bg-bg">
        {notEnriched || !game.coverUrl ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            (no art)
          </div>
        ) : (
          <img src={game.coverUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="text-sm font-medium">{game.name}</div>
      {showRating && game.steamReviewScoreDesc && game.steamReviewCount != null && (
        <div className="text-xs text-muted">
          {game.steamReviewScoreDesc} · {formatCount(game.steamReviewCount)} reviews
        </div>
      )}
      <div className="text-xs text-muted">
        Owned by {ownerCount}/{groupSize}
      </div>
      {showThumbs && (
        <div className="mt-1 flex gap-1">
          {lowConfidence && counts.up + counts.down === 0 ? (
            <div className="flex-1 rounded border border-border bg-bg py-1 text-center text-xs text-muted">
              no votes yet
            </div>
          ) : (
            <>
              <button
                onClick={() => void setVoteAndPersist(1)}
                disabled={busy}
                aria-label="Thumbs up"
                title="Thumbs up"
                className={`flex flex-1 items-center justify-center gap-1 rounded border py-1 text-xs transition disabled:opacity-50 ${
                  vote === 1
                    ? 'border-success bg-success/10 text-success'
                    : 'border-border text-muted hover:border-success hover:text-success'
                }`}
              >
                <ThumbUpIcon /> {counts.up}
              </button>
              <button
                onClick={() => void setVoteAndPersist(-1)}
                disabled={busy}
                aria-label="Thumbs down"
                title="Thumbs down"
                className={`flex flex-1 items-center justify-center gap-1 rounded border py-1 text-xs transition disabled:opacity-50 ${
                  vote === -1
                    ? 'border-danger bg-danger/10 text-danger'
                    : 'border-border text-muted hover:border-danger hover:text-danger'
                }`}
              >
                <ThumbDownIcon /> {counts.down}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
