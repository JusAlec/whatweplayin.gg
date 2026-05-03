import { useEffect, useState } from 'react';
import type { StablePrefs } from '@wwp/recommender';
import { VOTED_DIMS } from '@wwp/recommender';
import PrefSliders from './PrefSliders.js';
import { CATALOG } from '../lib/catalog.js';
import { loadGroupBundle } from '../lib/people.js';
import { kv } from '../lib/kv-client.js';

const NEUTRAL: StablePrefs = {
  combat: 3,
  grind: 3,
  buildingDepth: 3,
  commitmentLevel: 3,
  pvpFocus: 3,
  sessionLength: 3,
};

type Step = 'prefs' | 'played' | 'rate' | 'owned' | 'done';

interface Props {
  personId: string;
}

export default function OnboardingWizard({ personId }: Props) {
  const [step, setStep] = useState<Step>('prefs');
  const [prefs, setPrefs] = useState<StablePrefs>(NEUTRAL);
  const [playedIds, setPlayedIds] = useState<Set<string>>(new Set());
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [rateIdx, setRateIdx] = useState(0);
  const [pendingVotes, setPendingVotes] = useState<Record<string, StablePrefs>>({});
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    void loadGroupBundle().then((b) => {
      const me = b.people.find((p) => p.id === personId);
      if (me) setDisplayName(me.displayName);
    });
  }, [personId]);

  if (step === 'prefs') {
    return (
      <Wrap title={`Welcome, ${displayName}`} subtitle="Set your stable preferences">
        <PrefSliders initial={prefs} onChange={setPrefs} debounceMs={50} />
        <NextBtn onClick={() => setStep('played')}>Next: which games have you played?</NextBtn>
      </Wrap>
    );
  }

  if (step === 'played') {
    return (
      <Wrap title="Which games have you played?" subtitle="Pick the ones you can rate.">
        <ul className="divide-y divide-border">
          {CATALOG.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-2">
              <span>{g.name}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={playedIds.has(g.id)}
                onChange={() => {
                  const next = new Set(playedIds);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  setPlayedIds(next);
                }}
              />
            </li>
          ))}
        </ul>
        <NextBtn onClick={() => setStep(playedIds.size === 0 ? 'owned' : 'rate')}>
          {playedIds.size === 0 ? 'Skip rating' : `Rate ${playedIds.size} games`}
        </NextBtn>
      </Wrap>
    );
  }

  if (step === 'rate') {
    const playedArr = CATALOG.filter((g) => playedIds.has(g.id));
    const game = playedArr[rateIdx];
    if (!game) return null;
    return (
      <Wrap title={game.name} subtitle={`Rating ${rateIdx + 1} of ${playedArr.length}`}>
        <PrefSliders
          initial={pendingVotes[game.id] ?? NEUTRAL}
          onChange={(p) => setPendingVotes({ ...pendingVotes, [game.id]: p })}
          debounceMs={50}
        />
        <NextBtn
          onClick={async () => {
            const v = pendingVotes[game.id] ?? NEUTRAL;
            for (const dim of VOTED_DIMS) {
              await kv
                .put(`/votes/${personId}/${game.id}/${dim}`, { value: v[dim] })
                .catch(() => {});
            }
            if (rateIdx + 1 >= playedArr.length) setStep('owned');
            else setRateIdx(rateIdx + 1);
          }}
        >
          {rateIdx + 1 >= playedArr.length ? 'Done rating' : 'Next game'}
        </NextBtn>
      </Wrap>
    );
  }

  if (step === 'owned') {
    return (
      <Wrap
        title="Which games do you own?"
        subtitle="Hard filter — only owned games can be picked."
      >
        <ul className="divide-y divide-border">
          {CATALOG.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-2">
              <span>{g.name}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={ownedIds.has(g.id)}
                onChange={() => {
                  const next = new Set(ownedIds);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  setOwnedIds(next);
                }}
              />
            </li>
          ))}
        </ul>
        <NextBtn
          onClick={async () => {
            await kv.put(`/people/${personId}/prefs`, prefs).catch(() => {});
            for (const g of CATALOG) {
              await kv.put(`/people/${personId}/owns/${g.id}`, ownedIds.has(g.id)).catch(() => {});
            }
            setStep('done');
          }}
        >
          Finish
        </NextBtn>
      </Wrap>
    );
  }

  return (
    <Wrap title="You're set" subtitle="Your prefs and ownership are saved.">
      <a href="/" className="block bg-accent text-bg font-semibold rounded py-3 text-center mt-4">
        Go to Home
      </a>
    </Wrap>
  );
}

function Wrap({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted text-sm">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

function NextBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="bg-accent text-bg font-semibold rounded py-3 mt-4">
      {children}
    </button>
  );
}
