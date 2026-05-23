// sessions.js
import crypto from 'crypto';
import db from './db.js'; // better-sqlite3 instance
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 1000 * 60 * 60 * 24 * 7; // 7 days

// Ensure sessions table exists with account_email
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account_email ON sessions(account_email);
`);

// Transaction wrapper for atomic delete+insert
const createSessionTxn = db.transaction((accountEmail, token, now, expires) => {
  // remove existing sessions for this email
  db.prepare(`DELETE FROM sessions WHERE account_email = ?`).run(accountEmail);
  // insert the new session
  db.prepare(`INSERT INTO sessions (token, account_email, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(token, accountEmail, now, expires);
});

/**
 * Create a new session row and return { token, accountEmail, createdAt, expiresAt }.
 * This invalidates (deletes) any existing sessions for the same accountEmail first.
 */
export function createSession(accountEmail) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;

  // run delete + insert atomically
  createSessionTxn(accountEmail, token, now, expires);

  return { token, accountEmail, createdAt: now, expiresAt: expires };
}

/**
 * Look up a session by token. If expired it will be deleted and null returned.
 * Returns { token, accountEmail, createdAt, expiresAt } or null.
 */
export function getSession(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT token, account_email, created_at, expires_at FROM sessions WHERE token = ?`).get(token);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return { token: row.token, accountEmail: row.account_email, createdAt: row.created_at, expiresAt: row.expires_at };
}

/**
 * Delete a single session by token.
 */
export function deleteSession(token) {
  if (!token) return null;
  return db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

/**
 * Delete all sessions for an account (by email).
 */
export function deleteSessionsForAccount(accountEmail) {
  return db.prepare(`DELETE FROM sessions WHERE account_email = ?`).run(accountEmail);
}

export default {
  createSession,
  getSession,
  deleteSession,
  deleteSessionsForAccount
};