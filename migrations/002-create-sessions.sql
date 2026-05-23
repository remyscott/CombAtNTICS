CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_email ON sessions(account_email);