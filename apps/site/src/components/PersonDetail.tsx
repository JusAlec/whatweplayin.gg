import { useEffect, useState } from 'react';
import type { Person, StablePrefs } from '@gno/recommender';
import PrefSliders from './PrefSliders.js';
import OwnershipGrid from './OwnershipGrid.js';
import { CATALOG } from '../lib/catalog.js';
import { loadGroupBundle } from '../lib/people.js';
import { kv } from '../lib/kv-client.js';

interface Props {
  personId: string;
}

export default function PersonDetail({ personId }: Props) {
  const [person, setPerson] = useState<Person | null>(null);
  const [owned, setOwned] = useState<Record<string, boolean>>({});
  const [savedPrefs, setSavedPrefs] = useState<StablePrefs | null>(null);

  useEffect(() => {
    (async () => {
      const bundle = await loadGroupBundle();
      const me = bundle.people.find((p) => p.id === personId);
      if (!me) throw new Error(`person ${personId} not in group`);
      const stored = await kv.get<StablePrefs | null>(`/people/${personId}/prefs`);
      setPerson(me);
      setSavedPrefs(stored ?? me.stablePrefs);
      const ownership: Record<string, boolean> = {};
      for (const g of CATALOG) {
        ownership[g.id] =
          (await kv.get<boolean | null>(`/people/${personId}/owns/${g.id}`)) ?? false;
      }
      setOwned(ownership);
    })();
  }, [personId]);

  if (!person || !savedPrefs) return <p className="text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{person.displayName}</h1>
        <p className="text-muted text-sm">Stable preferences and ownership</p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-2">Preferences</h2>
        <PrefSliders
          initial={savedPrefs}
          onChange={(p) => kv.put(`/people/${personId}/prefs`, p).catch(() => {})}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Ownership</h2>
        <OwnershipGrid personId={personId} games={CATALOG} initialOwned={owned} />
      </section>
    </div>
  );
}
