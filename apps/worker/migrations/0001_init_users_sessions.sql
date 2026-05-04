-- WhatWePlayin v2 — initial schema: identity (Better Auth backing tables)

CREATE TABLE users (
  id              TEXT PRIMARY KEY,           -- ulid
  email           TEXT UNIQUE,                -- nullable: Steam-only signup has no email
  email_verified  INTEGER NOT NULL DEFAULT 0, -- boolean
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  created_at      TEXT NOT NULL,              -- ISO timestamp
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,           -- ulid
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
