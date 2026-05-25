PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT 'NoName',
  roles TEXT DEFAULT 'player',
  created_at INTEGER NOT NULL,      -- unix ms
  updated_at INTEGER,
  -- optional fields:
  email_verified INTEGER DEFAULT 0,
  verify_token TEXT,
  verify_token_expires INTEGER
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);