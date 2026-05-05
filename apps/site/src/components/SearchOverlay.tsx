import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api-client.js';
import { SearchIcon, CloseIcon } from './icons.js';

interface LibraryItem {
  game: { id: string; name: string; coverUrl: string | null };
  ownerCount: number;
}
interface LibraryResponse {
  games: LibraryItem[];
  total: number;
}

interface SearchOverlayProps {
  groupId: string;
  onSelect: (gameId: string) => void;
}

export function SearchOverlay({ groupId, onSelect }: SearchOverlayProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get<LibraryResponse>(
          `/api/groups/${groupId}/library?q=${encodeURIComponent(q.trim())}&limit=30`,
        );
        setResults(r.games);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open, groupId]);

  return (
    <>
      <button
        type="button"
        aria-label="Search games"
        onClick={() => setOpen(true)}
        className="rounded p-2 text-muted hover:bg-bg hover:text-text"
      >
        <SearchIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-bg/95 backdrop-blur"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto mt-12 max-w-3xl px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 rounded border border-border bg-panel p-3">
              <SearchIcon className="h-4 w-4 text-muted" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search this group's library…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text outline-none"
              />
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:text-text"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-1">
              {loading && <p className="p-3 text-sm text-muted">Searching…</p>}
              {!loading && q.trim().length > 0 && results.length === 0 && (
                <p className="p-3 text-sm text-muted">No games match "{q}".</p>
              )}
              {results.map((it) => (
                <button
                  key={it.game.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(it.game.id);
                  }}
                  className="flex w-full items-center gap-3 rounded border border-transparent p-2 text-left hover:border-border hover:bg-panel"
                >
                  {it.game.coverUrl ? (
                    <img
                      src={it.game.coverUrl}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-16 shrink-0 rounded bg-panel" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text">{it.game.name}</div>
                    <div className="text-xs text-muted">Owned by {it.ownerCount}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
