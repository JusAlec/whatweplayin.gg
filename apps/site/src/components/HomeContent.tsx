import { useEffect, useState } from 'react';
import type { SessionRecord } from '@wwp/recommender';
import { CATALOG, getGame } from '../lib/catalog.js';
import { kv } from '../lib/kv-client.js';

export default function HomeContent() {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    (async () => {
      const fetched: Record<string, string> = {};
      for (const g of CATALOG) {
        const s = await kv.get<string | null>(`/games/${g.id}/status`).catch(() => null);
        if (s) fetched[g.id] = s;
      }
      setStatuses(fetched);
      const list = (await kv.get<SessionRecord[]>('/sessions').catch(() => [])) ?? [];
      setSessions(list.slice(0, 3));
    })();
  }, []);

  const inProgress = CATALOG.filter((g) => statuses[g.id] === 'in_progress').slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">What We Playin</h1>
      </header>

      <a
        href="/session/setup"
        className="block bg-accent text-bg font-semibold rounded py-4 text-center text-lg"
      >
        Start Tonight's Session
      </a>

      {inProgress.length > 0 && (
        <section>
          <h2 className="text-sm uppercase text-muted mb-2">In progress</h2>
          <ul className="divide-y divide-border">
            {inProgress.map((g) => (
              <li key={g.id}>
                <a href={`/library/${g.id}`} className="flex justify-between py-3">
                  <span>{g.name}</span>
                  <span className="text-muted text-sm">resume →</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase text-muted mb-2">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-muted text-sm">No sessions logged yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.startedAt} className="py-2 text-sm">
                <div className="flex justify-between">
                  <span>{getGame(s.gamePicked)?.name ?? s.gamePicked}</span>
                  <span className="text-muted">{new Date(s.startedAt).toLocaleDateString()}</span>
                </div>
                <div className="text-xs text-muted">
                  {s.attendees.length} player{s.attendees.length === 1 ? '' : 's'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
