-- v2.1: thumbs voting + Steam review metadata + per-user library sync timestamp

CREATE TABLE thumbs (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  game_id    TEXT NOT NULL REFERENCES games(id),
  vote       INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  voted_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id, game_id)
);

CREATE INDEX idx_thumbs_group_game ON thumbs(group_id, game_id);
CREATE INDEX idx_thumbs_user_game  ON thumbs(user_id, game_id);

ALTER TABLE games ADD COLUMN steam_review_score        INTEGER;
ALTER TABLE games ADD COLUMN steam_review_score_desc   TEXT;
ALTER TABLE games ADD COLUMN steam_review_pct_positive REAL;
ALTER TABLE games ADD COLUMN steam_review_count        INTEGER;

ALTER TABLE users ADD COLUMN steam_library_synced_at TEXT;
