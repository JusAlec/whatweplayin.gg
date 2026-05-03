import { useEffect, useState } from 'react';
import { CATALOG } from '../lib/catalog.js';
import { kv } from '../lib/kv-client.js';

export default function GameGrid() {
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const fetched: Record<string, string> = {};
      for (const g of CATALOG) {
        const s = await kv.get<string | null>(`/games/${g.id}/status`).catch(() => null);
        if (s) fetched[g.id] = s;
      }
      setStatuses(fetched);
    })();
  }, []);

  const sorted = [...CATALOG].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ul className="divide-y divide-border">
      {sorted.map((g) => (
        <li key={g.id}>
          <a href={`/library/${g.id}`} className="flex items-center justify-between py-3">
            <div>
              <div className="font-medium">{g.name}</div>
              <div className="text-xs text-muted">
                {g.minPlayers}-{g.maxPlayers} players · {g.releaseStatus}
              </div>
            </div>
            <span className="text-xs text-muted">
              {STATUS_LABEL[statuses[g.id] ?? 'not_started'] ?? 'not started'}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  shelved: 'shelved',
  completed: 'completed',
  pending_update: 'pending update',
};
