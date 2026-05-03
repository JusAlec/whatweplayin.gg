import { useEffect, useState } from 'react';
import type { Person } from '@wwp/recommender';
import { loadGroupBundle } from '../lib/people.js';

const TIME_PRESETS = [30, 60, 90, 120, 180, 240, 360];

export default function SessionSetup() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [attending, setAttending] = useState<Set<string>>(new Set());
  const [timeMins, setTimeMins] = useState(120);

  useEffect(() => {
    void loadGroupBundle().then((b) => {
      setPeople(b.people);
      setAttending(new Set(b.people.map((p) => p.id)));
    });
  }, []);

  if (!people) return <p className="text-muted">Loading...</p>;

  function go() {
    const ids = [...attending].join(',');
    window.location.href = `/session/recommend?attendees=${ids}&time=${timeMins}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Tonight</h1>
        <p className="text-muted text-sm">Pick who's here and how long you have.</p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-2">Who's here?</h2>
        <ul className="divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>{p.displayName}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={attending.has(p.id)}
                onChange={() => {
                  const next = new Set(attending);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  setAttending(next);
                }}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Time available</h2>
        <div className="flex gap-2 flex-wrap">
          {TIME_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => setTimeMins(m)}
              className={`px-3 py-2 rounded border text-sm ${
                timeMins === m ? 'bg-accent text-bg border-accent' : 'border-border text-muted'
              }`}
            >
              {m < 60 ? `${m}m` : `${m / 60}h`}
            </button>
          ))}
        </div>
      </section>

      <button
        onClick={go}
        disabled={attending.size === 0}
        className="bg-accent text-bg font-semibold rounded py-3 mt-2 disabled:opacity-50"
      >
        Get Recommendation
      </button>
    </div>
  );
}
