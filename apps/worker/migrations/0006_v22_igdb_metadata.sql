-- v2.2: IGDB metadata layered on top of Steam Store + Twitch OAuth token cache

ALTER TABLE games ADD COLUMN igdb_screenshot_id TEXT;

CREATE TABLE igdb_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
