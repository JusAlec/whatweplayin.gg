import type { GameV22 } from '@wwp/auth-shared';

interface HeroPick {
  game: GameV22;
  score: number;
  ownerCount: number;
  groupSize: number;
  thumbs: { up: number; down: number };
}

interface HeroCardProps {
  pick: HeroPick | null;
  onSelect: () => void;
}

const IGDB_HERO_BASE = 'https://images.igdb.com/igdb/image/upload/t_1080p';

function heroBackdropUrl(game: GameV22): string | null {
  if (game.igdbScreenshotId) return `${IGDB_HERO_BASE}/${game.igdbScreenshotId}.jpg`;
  return game.coverUrl ?? null;
}

export function HeroCard({ pick, onSelect }: HeroCardProps) {
  if (!pick) {
    return (
      <div className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded bg-panel">
        <div className="flex h-full items-center justify-center">
          <p className="text-muted">
            No recommendations yet — sync your Steam library to get started.
          </p>
        </div>
      </div>
    );
  }
  const backdrop = heroBackdropUrl(pick.game);
  return (
    <div className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded">
      {backdrop ? (
        <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-panel" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
      <div className="relative flex h-full flex-col justify-end gap-3 p-6 md:p-10 max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-accent">Tonight's pick</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">{pick.game.name}</h1>
        {pick.game.description && (
          <p className="line-clamp-3 text-sm text-white/80 md:text-base">{pick.game.description}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-white/70">
          <span>
            Owned by {pick.ownerCount}/{pick.groupSize}
          </span>
          {pick.thumbs.up > 0 && <span>{pick.thumbs.up} thumbs up</span>}
          {pick.game.genres && pick.game.genres.length > 0 && (
            <span>{pick.game.genres.slice(0, 3).join(' · ')}</span>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={onSelect}
            className="mt-2 inline-flex items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            More info
          </button>
        </div>
      </div>
    </div>
  );
}
