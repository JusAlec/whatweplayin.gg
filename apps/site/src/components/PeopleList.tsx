import { useEffect, useState } from 'react';
import type { Person } from '@gno/recommender';
import { loadGroupBundle } from '../lib/people.js';

export default function PeopleList() {
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => { void loadGroupBundle().then((b) => setPeople(b.people)); }, []);
  if (!people) return <p className="text-muted">Loading...</p>;
  return (
    <ul className="divide-y divide-border">
      {people.map((p) => (
        <li key={p.id}>
          <a href={`/people/${p.id}`} className="flex items-center justify-between py-3">
            <span>{p.displayName}</span>
            <span className="text-muted text-sm">→</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
