-- Catalog: cached metadata for games discovered via Steam imports + IGDB enrichment.

CREATE TABLE games (
  id                TEXT PRIMARY KEY,           -- slug for curated, e.g. 'valheim'; 'steam-<appid>' for auto
  name              TEXT NOT NULL,
  steam_app_id      INTEGER UNIQUE,             -- nullable for non-Steam games
  igdb_id           INTEGER UNIQUE,             -- nullable until IGDB enrichment runs
  description       TEXT,                       -- IGDB summary, truncated to 500 chars
  cover_url         TEXT,                       -- IGDB cover art URL
  hero_url          TEXT,                       -- Steam library_hero.jpg OR IGDB screenshot
  min_players       INTEGER NOT NULL DEFAULT 1,
  max_players       INTEGER NOT NULL DEFAULT 1,
  optimal_min       INTEGER,
  optimal_max       INTEGER,
  genres            TEXT NOT NULL DEFAULT '[]', -- JSON array of genre tags
  has_singleplayer  INTEGER NOT NULL DEFAULT 1,
  has_coop          INTEGER NOT NULL DEFAULT 0,
  has_pvp           INTEGER NOT NULL DEFAULT 0,
  release_status    TEXT NOT NULL DEFAULT 'released', -- 'early-access' | 'released' | 'live-service' | 'maintenance-mode'
  release_date      TEXT,                       -- ISO date
  catalog_tier      TEXT NOT NULL DEFAULT 'auto',     -- 'curated' | 'auto'
  metadata_synced_at TEXT NOT NULL              -- ISO timestamp of last IGDB/Steam sync
);

CREATE INDEX idx_games_steam ON games(steam_app_id);
CREATE INDEX idx_games_tier ON games(catalog_tier);
CREATE INDEX idx_games_synced ON games(metadata_synced_at);

CREATE TABLE game_ownership (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id           TEXT NOT NULL REFERENCES games(id),
  source            TEXT NOT NULL,              -- 'steam' | 'manual'
  playtime_minutes  INTEGER NOT NULL DEFAULT 0,
  last_played_at    TEXT,                       -- ISO from Steam, nullable for manual
  added_at          TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX idx_ownership_game ON game_ownership(game_id);
CREATE INDEX idx_ownership_source ON game_ownership(source);
