CREATE TABLE oauth_accounts (
  id                TEXT PRIMARY KEY,           -- ulid
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,              -- 'steam' (more in v3)
  provider_user_id  TEXT NOT NULL,              -- Steam ID 64
  provider_data     TEXT,                       -- JSON: { personaname, profileurl, avatarfull }
  created_at        TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE magic_link_tokens (
  token             TEXT PRIMARY KEY,           -- random 64-hex (32 bytes)
  email             TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  used_at           TEXT,                       -- nullable; set when redeemed
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_magic_email ON magic_link_tokens(email);
CREATE INDEX idx_magic_expires ON magic_link_tokens(expires_at);
