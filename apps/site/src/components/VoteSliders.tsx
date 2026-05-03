import { useEffect, useState } from 'react';
import type { StablePrefs, VotedDim } from '@gno/recommender';
import { VOTED_DIMS } from '@gno/recommender';

const LABELS: Record<VotedDim, string> = {
  combat: 'Combat',
  grind: 'Grind',
  buildingDepth: 'Building',
  commitmentLevel: 'Commitment',
  pvpFocus: 'PvP',
  sessionLength: 'Session length',
};

interface Props {
  initial: StablePrefs;
  onDimChange: (dim: VotedDim, value: number) => void;
  debounceMs?: number;
}

export default function VoteSliders({ initial, onDimChange, debounceMs = 600 }: Props) {
  const [vals, setVals] = useState<StablePrefs>(initial);
  const [pending, setPending] = useState<Set<VotedDim>>(new Set());

  useEffect(() => {
    if (pending.size === 0) return;
    const t = setTimeout(() => {
      pending.forEach((d) => onDimChange(d, vals[d]));
      setPending(new Set());
    }, debounceMs);
    return () => clearTimeout(t);
  }, [pending, vals, onDimChange, debounceMs]);

  return (
    <div className="flex flex-col gap-4">
      {VOTED_DIMS.map((dim) => (
        <label key={dim}>
          <div className="flex justify-between text-sm">
            <span>{LABELS[dim]}</span>
            <span className="text-muted">{vals[dim]}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={vals[dim]}
            onChange={(e) => {
              setVals({ ...vals, [dim]: Number(e.target.value) });
              const next = new Set(pending);
              next.add(dim);
              setPending(next);
            }}
            className="w-full accent-accent"
          />
        </label>
      ))}
    </div>
  );
}
