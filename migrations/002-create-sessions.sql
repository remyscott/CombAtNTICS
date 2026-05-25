CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_username ON sessions(account_username);