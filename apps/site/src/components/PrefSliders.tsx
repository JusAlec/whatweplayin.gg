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

const HINTS: Record<VotedDim, [string, string]> = {
  combat: ['peaceful', 'intense'],
  grind: ['none', 'heavy'],
  buildingDepth: ['minimal', 'deep'],
  commitmentLevel: ['casual', 'invested'],
  pvpFocus: ['PvE', 'PvP'],
  sessionLength: ['quick', 'marathon'],
};

interface Props {
  initial: StablePrefs;
  onChange: (prefs: StablePrefs) => void;
  debounceMs?: number;
}

export default function PrefSliders({ initial, onChange, debounceMs = 600 }: Props) {
  const [prefs, setPrefs] = useState<StablePrefs>(initial);

  useEffect(() => {
    const t = setTimeout(() => onChange(prefs), debounceMs);
    return () => clearTimeout(t);
  }, [prefs, debounceMs, onChange]);

  return (
    <div className="flex flex-col gap-4">
      {VOTED_DIMS.map((dim) => (
        <label key={dim} className="block">
          <div className="flex justify-between text-sm">
            <span>{LABELS[dim]}</span>
            <span className="text-muted">{prefs[dim]}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={prefs[dim]}
            onChange={(e) => setPrefs({ ...prefs, [dim]: Number(e.target.value) })}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-muted">
            <span>{HINTS[dim][0]}</span>
            <span>{HINTS[dim][1]}</span>
          </div>
        </label>
      ))}
    </div>
  );
}
