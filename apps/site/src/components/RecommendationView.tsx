import { useEffect, useState } from 'react';
import type { RecommendationResponse } from '@gno/recommender';
import { recommend } from '@gno/recommender';
import { CATALOG, getGame } from '../lib/catalog.js';
import { buildContext } from '../lib/build-context.js';
import { kv } from '../lib/kv-client.js';
import PickCard from './PickCard.js';

interface Props {
  attendees: string[];
  timeMins: number;
}

export default function RecommendationView({ attendees, timeMins }: Props) {
  const [resp, setResp] = useState<RecommendationResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ctx = await buildContext(attendees, timeMins);
        setResp(recommend(CATALOG, ctx));
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [attendees, timeMins]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!resp) return <p className="text-muted">Generating...</p>;
  if (resp.picks.length === 0) {
    return (
      <section>
        <h1 className="text-xl font-semibold">No game fits</h1>
        <p className="text-muted text-sm mb-4">
          {resp.excluded.length} games filtered out — common reasons below.
        </p>
        <ExcludedList excluded={resp.excluded} />
      </section>
    );
  }

  async function lockIn(rank: number) {
    if (!resp || !resp.picks[rank - 1]) return;
    const pick = resp.picks[rank - 1];
    const session = {
      startedAt: new Date().toISOString(),
      attendees,
      gamePicked: pick.game,
      recommendationScore: pick.score,
      recommendedRank: rank,
    };
    await kv.post('/sessions', session).catch(() => {});
    await kv.put(`/games/${pick.game}/status`, 'in_progress').catch(() => {});
    window.location.href = '/';
  }

  const top = resp.picks[0]!;
  const rest = resp.picks.slice(1);

  return (
    <div className="flex flex-col gap-4">
      <PickCard pick={top} rank={1} expanded onLockIn={() => lockIn(1)} />
      {rest.length > 0 && (
        <section>
          <h2 className="text-sm uppercase text-muted mb-2">Also considered</h2>
          <div className="flex flex-col gap-3">
            {rest.map((p, i) => (
              <PickCard key={p.game} pick={p} rank={i + 2} onLockIn={() => lockIn(i + 2)} />
            ))}
          </div>
        </section>
      )}
      <button
        onClick={() => setShowExcluded((s) => !s)}
        className="text-sm text-muted underline mt-2"
      >
        {showExcluded ? 'Hide' : 'Show'} {resp.excluded.length} excluded game(s)
      </button>
      {showExcluded && <ExcludedList excluded={resp.excluded} />}
    </div>
  );
}

function ExcludedList({ excluded }: { excluded: { game: string; reason: string }[] }) {
  return (
    <ul className="text-sm text-muted divide-y divide-border bg-panel rounded">
      {excluded.map((e) => (
        <li key={e.game} className="px-3 py-2">
          <strong className="text-text">{getGame(e.game)?.name ?? e.game}</strong> — {e.reason}
        </li>
      ))}
    </ul>
  );
}
