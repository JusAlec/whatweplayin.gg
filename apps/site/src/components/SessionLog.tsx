import { useEffect, useState } from 'react';
import type { SessionRecord } from '@gno/recommender';
import { getGame } from '../lib/catalog.js';
import { kv } from '../lib/kv-client.js';

export default function SessionLog() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void kv.get<SessionRecord[]>('/sessions')
      .then((s) => setSessions(s ?? []))
      .catch(() => setSessions([]));
  }, []);

  if (sessions === null) return <p className="text-muted">Loading...</p>;
  if (sessions.length === 0) return <p className="text-muted">No sessions logged yet.</p>;

  return (
    <ul className="divide-y divide-border">
      {sessions.map((s) => {
        const isExp = expanded === s.startedAt;
        return (
          <li key={s.startedAt} className="py-3">
            <button
              onClick={() => setExpanded(isExp ? null : s.startedAt)}
              className="w-full flex justify-between items-center text-left"
            >
              <div>
                <div className="font-medium">{getGame(s.gamePicked)?.name ?? s.gamePicked}</div>
                <div className="text-xs text-muted">
                  {new Date(s.startedAt).toLocaleString()} · {s.attendees.length} player{s.attendees.length === 1 ? '' : 's'}
                </div>
              </div>
              <span className="text-muted">{isExp ? '−' : '+'}</span>
            </button>
            {isExp && (
              <div className="mt-2 text-sm text-muted">
                <div>Attendees: {s.attendees.join(', ')}</div>
                {s.recommendationScore != null && (
                  <div>Score: {(s.recommendationScore * 100).toFixed(0)} (rank #{s.recommendedRank ?? 'manual'})</div>
                )}
                {s.duration != null && <div>Duration: {s.duration}m</div>}
                {s.milestonesHit && s.milestonesHit.length > 0 && (
                  <div>Milestones: {s.milestonesHit.join(', ')}</div>
                )}
                {s.notes && <div>Notes: {s.notes}</div>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
