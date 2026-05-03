import { useEffect, useState } from 'react';
import type { Person } from '@wwp/recommender';
import { loadGroupBundle } from '../lib/people.js';
import { readActivePerson, writeActivePerson } from '../lib/auth.js';

export default function PeopleList() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    void loadGroupBundle().then((b) => setPeople(b.people));
    setActive(readActivePerson());
  }, []);
  if (!people) return <p className="text-muted">Loading...</p>;
  return (
    <ul className="divide-y divide-border">
      {people.map((p) => (
        <li key={p.id} className="py-2 flex items-center justify-between">
          <a href={`/people/${p.id}`} className="flex-1">
            {p.displayName}
          </a>
          <button
            onClick={() => {
              writeActivePerson(p.id);
              setActive(p.id);
            }}
            className={`text-xs px-2 py-1 rounded border ${
              active === p.id ? 'bg-accent text-bg border-accent' : 'border-border text-muted'
            }`}
          >
            {active === p.id ? 'this is me' : 'set as me'}
          </button>
        </li>
      ))}
    </ul>
  );
}
