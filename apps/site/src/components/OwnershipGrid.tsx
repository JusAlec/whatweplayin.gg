import { useState } from 'react';
import type { Game } from '@wwp/recommender';
import { kv, NetworkError } from '../lib/kv-client.js';

interface Props {
  personId: string;
  games: Game[];
  initialOwned: Record<string, boolean>;
}

export default function OwnershipGrid({ personId, games, initialOwned }: Props) {
  const [owned, setOwned] = useState(initialOwned);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function toggle(gameId: string) {
    const next = !owned[gameId];
    setOwned({ ...owned, [gameId]: next });
    try {
      await kv.put(`/people/${personId}/owns/${gameId}`, next);
      const { [gameId]: _drop, ...rest } = errorById;
      setErrorById(rest);
    } catch (err) {
      const msg = err instanceof NetworkError ? 'queued (offline)' : 'failed';
      setErrorById({ ...errorById, [gameId]: msg });
    }
  }

  const sorted = [...games].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ul className="divide-y divide-border">
      {sorted.map((g) => (
        <li key={g.id} className="flex items-center justify-between py-2">
          <span>{g.name}</span>
          <div className="flex items-center gap-2">
            {errorById[g.id] && <span className="text-xs text-warning">{errorById[g.id]}</span>}
            <input
              type="checkbox"
              checked={owned[g.id] ?? false}
              onChange={() => toggle(g.id)}
              className="h-5 w-5 accent-accent"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
