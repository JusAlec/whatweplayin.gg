import { useEffect, useState } from 'react';
import type { StablePrefs, VotedDim } from '@wwp/recommender';
import VoteSliders from './VoteSliders.js';
import { getGame } from '../lib/catalog.js';
import { kv } from '../lib/kv-client.js';

const STATUSES = ['not_started', 'in_progress', 'shelved', 'completed', 'pending_update'] as const;
const NEUTRAL: StablePrefs = {
  combat: 3,
  grind: 3,
  buildingDepth: 3,
  commitmentLevel: 3,
  pvpFocus: 3,
  sessionLength: 3,
};

interface Props {
  gameId: string;
  personId: string | null;
}

export default function GameDetail({ gameId, personId }: Props) {
  const game = getGame(gameId);
  const [status, setStatus] = useState<string>('not_started');
  const [goal, setGoal] = useState('');
  const [myVotes, setMyVotes] = useState<StablePrefs>(NEUTRAL);
  const [groupAvg, setGroupAvg] = useState<Record<VotedDim, number> | null>(null);

  useEffect(() => {
    (async () => {
      const s = await kv.get<string | null>(`/games/${gameId}/status`).catch(() => null);
      if (s) setStatus(s);
      const cache = await kv
        .get<Record<VotedDim, { avg: number; n: number }> | null>(`/state`)
        .catch(() => null);
      // best-effort: pull avg if available
      if (cache) {
        const c = (
          cache as unknown as { ratingCache?: Record<string, Record<string, { avg: number }>> }
        ).ratingCache?.[gameId];
        if (c) {
          const avg = {} as Record<VotedDim, number>;
          for (const d of Object.keys(c) as VotedDim[]) avg[d] = c[d]!.avg;
          setGroupAvg(avg);
        }
      }
      if (personId) {
        const next = { ...NEUTRAL };
        for (const dim of Object.keys(NEUTRAL) as VotedDim[]) {
          const v = await kv
            .get<{ value: number } | null>(`/votes/${personId}/${gameId}/${dim}`)
            .catch(() => null);
          if (v) next[dim] = v.value;
        }
        setMyVotes(next);
      }
    })();
  }, [gameId, personId]);

  if (!game) return <p>Unknown game</p>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{game.name}</h1>
        <p className="text-muted text-sm">
          {game.minPlayers}-{game.maxPlayers} players · {game.hostingModel} · {game.releaseStatus}
        </p>
      </header>

      <section>
        <label className="block">
          <span className="text-sm">Status</span>
          <select
            value={status}
            onChange={async (e) => {
              setStatus(e.target.value);
              await kv.put(`/games/${gameId}/status`, e.target.value).catch(() => {});
            }}
            className="w-full bg-panel border border-border rounded px-2 py-1 mt-1"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <label className="block">
          <span className="text-sm">Custom completion goal (overrides default)</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onBlur={async () => {
              if (goal.trim().length > 0) {
                await kv
                  .put(`/games/${gameId}/progress`, { customGoalProgress: goal })
                  .catch(() => {});
              }
            }}
            placeholder="e.g. kill all biome bosses"
            className="w-full bg-panel border border-border rounded px-2 py-1 mt-1"
            maxLength={500}
          />
        </label>
      </section>

      {personId ? (
        <section>
          <h2 className="text-lg font-semibold mb-2">Your ratings</h2>
          <VoteSliders
            initial={myVotes}
            onDimChange={async (dim, value) => {
              await kv.put(`/votes/${personId}/${gameId}/${dim}`, { value }).catch(() => {});
            }}
          />
        </section>
      ) : (
        <p className="text-warning text-sm">Sign in as a person on the People tab to vote.</p>
      )}

      {groupAvg && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Group consensus</h2>
          <ul className="text-sm grid grid-cols-2 gap-2">
            {Object.entries(groupAvg).map(([dim, avg]) => (
              <li key={dim} className="flex justify-between bg-panel rounded px-2 py-1">
                <span className="text-muted">{dim}</span>
                <span>{avg.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
