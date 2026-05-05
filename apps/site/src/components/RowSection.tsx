import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
import GameCard from './GameCard.js';
import { ChevronLeftIcon, ChevronRightIcon } from './icons.js';

interface LibraryGame {
  id: string;
  name: string;
  coverUrl: string | null;
  steamReviewScoreDesc: string | null;
  steamReviewPctPositive: number | null;
  steamReviewCount: number | null;
  metadataSyncedAt: string | null;
}

interface LibraryItem {
  game: LibraryGame;
}

interface LibraryResponse {
  games: LibraryItem[];
  total: number;
}

interface RowSectionProps {
  title: string;
  groupId: string;
  preset: 'most-owned' | 'co-op' | 'pvp' | 'recent' | 'hidden-gems';
  limit?: number;
  onCardClick: (gameId: string) => void;
}

export function RowSection({ title, groupId, preset, limit = 20, onCardClick }: RowSectionProps) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get<LibraryResponse>(
          `/api/groups/${groupId}/library?preset=${preset}&limit=${limit}`,
        );
        if (alive) setItems(r.games);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId, preset, limit]);

  function scroll(dir: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  }

  if (error) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-danger">Failed to load: {error}</p>
      </section>
    );
  }
  if (!items) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 w-32 shrink-0 animate-pulse rounded bg-panel" />
          ))}
        </div>
      </section>
    );
  }
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <div className="group relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-bg/80 p-2 text-text shadow group-hover:block"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((it) => (
            <GameCard
              key={it.game.id}
              game={it.game}
              variant="compact"
              onClick={() => onCardClick(it.game.id)}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-bg/80 p-2 text-text shadow group-hover:block"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
