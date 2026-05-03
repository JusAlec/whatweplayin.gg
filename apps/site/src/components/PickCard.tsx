import type { ScoredGame } from '@gno/recommender';
import { getGame } from '../lib/catalog.js';

const CONFIDENCE_LABEL = {
  group: 'Group consensus',
  global: 'Community votes',
  partial: 'Partial confidence',
  none: 'Low confidence',
};

const DIM_LABEL: Record<string, string> = {
  preferenceMatch: 'Preferences', groupFit: 'Group fit',
  sessionFit: 'Session fit', novelty: 'Novelty',
};

interface Props {
  pick: ScoredGame;
  rank: number;
  expanded?: boolean;
  onLockIn?: () => void;
}

export default function PickCard({ pick, rank, expanded = false, onLockIn }: Props) {
  const game = getGame(pick.game);
  if (!game) return null;
  return (
    <article className={`bg-panel border border-border rounded p-4 ${rank === 1 ? '' : 'opacity-90'}`}>
      <header className="flex items-start justify-between mb-2">
        <div>
          <h2 className={rank === 1 ? 'text-2xl font-bold' : 'text-lg font-semibold'}>{game.name}</h2>
          <p className="text-xs text-muted">{CONFIDENCE_LABEL[pick.confidence]}</p>
        </div>
        <span className="text-accent font-mono">{(pick.score * 100).toFixed(0)}</span>
      </header>

      {expanded && (
        <div className="flex flex-col gap-2 mb-3">
          {(['preferenceMatch', 'groupFit', 'sessionFit', 'novelty'] as const).map((dim) => {
            const b = pick.breakdown[dim];
            return (
              <div key={dim}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted">{DIM_LABEL[dim]}</span>
                  <span>{(b.contribution * 100).toFixed(0)}</span>
                </div>
                <div className="h-2 bg-bg rounded">
                  <div
                    className="h-2 bg-accent rounded"
                    style={{ width: `${(b.value * 100).toFixed(0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pick.flags.length > 0 && (
        <p className="text-xs text-warning mb-2">{pick.flags.join(' · ')}</p>
      )}

      {onLockIn && (
        <button
          onClick={onLockIn}
          className="w-full bg-accent text-bg font-semibold rounded py-2 mt-2"
        >
          Lock in this pick
        </button>
      )}
    </article>
  );
}
