CREATE TABLE groups (
  id                TEXT PRIMARY KEY,           -- slug like 'rivals' OR ulid for auto-named
  display_name      TEXT NOT NULL,
  creator_id        TEXT NOT NULL REFERENCES users(id),
  scoring_weights   TEXT NOT NULL,              -- JSON { preferenceMatch, groupFit, sessionFit, novelty }
  custom_completion_goals TEXT,                 -- JSON { gameId: string }
  created_at        TEXT NOT NULL,
  member_count      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_groups_creator ON groups(creator_id);

CREATE TABLE group_members (
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL DEFAULT 'member',  -- 'creator' | 'member'
  joined_at         TEXT NOT NULL,
  weight            REAL NOT NULL DEFAULT 1.0,
  stable_prefs      TEXT,                       -- JSON of 6 dim values; nullable until set
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_members_user ON group_members(user_id);
CREATE INDEX idx_members_group ON group_members(group_id);

CREATE TABLE group_invites (
  code              TEXT PRIMARY KEY,           -- random 8-char URL-safe slug
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by        TEXT NOT NULL REFERENCES users(id),
  expires_at        TEXT NOT NULL,              -- 7d default
  max_uses          INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited until expiry
  use_count         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_invites_group ON group_invites(group_id);
CREATE INDEX idx_invites_expires ON group_invites(expires_at);
