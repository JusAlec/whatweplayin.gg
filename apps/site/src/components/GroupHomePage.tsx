import { useEffect, useState } from 'react';
import { api } from '../lib/api-client.js';
import type { GameV22 } from '@wwp/auth-shared';
import { HeroCard } from './HeroCard.js';
import { RowSection } from './RowSection.js';
import { GameDetailModal } from './GameDetailModal.js';
import { SearchOverlay } from './SearchOverlay.js';
import { ArrowLeftIcon, SettingsIcon } from './icons.js';

interface RecPick {
  game: GameV22;
  score: number;
  breakdown: { thumbs: number; ownership: number; novelty: number; groupFit: number };
  flags: string[];
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
  yourVote: -1 | 0 | 1;
}

interface RecResponse {
  picks: RecPick[];
  generatedAt: string;
  weightsUsed: { thumbs: number; ownership: number; novelty: number; groupFit: number };
  coldStart: boolean;
}

interface GroupHomePageProps {
  groupId: string;
}

export default function GroupHomePage({ groupId }: GroupHomePageProps) {
  const [hero, setHero] = useState<RecPick | null>(null);
  const [modalGameId, setModalGameId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<RecResponse>(`/api/groups/${groupId}/recommendations`);
        setHero(r.picks[0] ?? null);
      } catch {
        setHero(null);
      }
    })();
    (async () => {
      try {
        const g = await api.get<any>(`/api/groups/${groupId}`);
        setGroupName(g?.group?.displayName ?? g?.group?.name ?? g?.displayName ?? g?.name ?? null);
      } catch {
        // fallthrough — show generic title
      }
    })();
  }, [groupId]);

  const heroPick = hero
    ? {
        game: hero.game,
        score: hero.score,
        ownerCount: hero.ownerCount,
        groupSize: hero.groupSize,
        thumbs: hero.thumbs,
      }
    : null;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <a
          href="/who"
          className="inline-flex items-center gap-1.5 rounded p-1 text-sm text-muted transition hover:text-text"
        >
          <ArrowLeftIcon /> Dashboard
        </a>
        <h1 className="flex-1 truncate text-center text-lg font-semibold">
          {groupName ?? 'Group'}
        </h1>
        <div className="flex items-center gap-1">
          <SearchOverlay groupId={groupId} onSelect={setModalGameId} />
          <a
            href={`/groups/${groupId}/settings`}
            aria-label="Group settings"
            title="Group settings"
            className="rounded p-2 text-muted transition hover:bg-bg hover:text-text"
          >
            <SettingsIcon className="h-4 w-4" />
          </a>
        </div>
      </header>

      <HeroCard pick={heroPick} onSelect={() => hero && setModalGameId(hero.game.id)} />

      <div className="space-y-6">
        <RowSection
          title="Most owned"
          groupId={groupId}
          preset="most-owned"
          onCardClick={setModalGameId}
        />
        <RowSection title="Co-op" groupId={groupId} preset="co-op" onCardClick={setModalGameId} />
        <RowSection title="PvP" groupId={groupId} preset="pvp" onCardClick={setModalGameId} />
        <RowSection
          title="Recently played"
          groupId={groupId}
          preset="recent"
          onCardClick={setModalGameId}
        />
        <RowSection
          title="Hidden gems"
          groupId={groupId}
          preset="hidden-gems"
          onCardClick={setModalGameId}
        />
      </div>

      <GameDetailModal
        gameId={modalGameId}
        groupId={groupId}
        onClose={() => setModalGameId(null)}
      />
    </div>
  );
}
