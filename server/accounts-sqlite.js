// accounts-sqlite.js
import db from './db.js';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

function now() { return Date.now(); }

export async function createAccount(email, plainPassword, displayName = 'NoName') {
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) throw new Error('email required');

  // check existing by email (email is primary key)
  const exists = db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(normalized);
  if (exists) throw new Error('email exists');

  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  const created = now();

  const stmt = db.prepare(`
    INSERT INTO accounts (email, password_hash, display_name, created_at)
    VALUES (@email, @password_hash, @display_name, @created_at)
  `);

  stmt.run({
    email: normalized,
    password_hash: hash,
    display_name: displayName,
    created_at: created
  });

  // return public object (no id)
  return { email: normalized, displayName, createdAt: created };
}

export async function authenticate(email, plainPassword) {
  const normalized = String(email).trim().toLowerCase();
  const row = db.prepare('SELECT email, password_hash, display_name, email_verified, created_at FROM accounts WHERE email = ?').get(normalized);
  if (!row) return null;
  const ok = await bcrypt.compare(plainPassword, row.password_hash);
  if (!ok) return null;
  return {
    email: row.email,
    displayName: row.display_name,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at
  };
}

export async function updateDisplayName(email, newDisplayName) {
  const normalized = String(email).trim().toLowerCase();
  const updatedAt = now();
  const stmt = db.prepare(`UPDATE accounts SET display_name = ?, updated_at = ? WHERE email = ?`);
  const info = stmt.run(newDisplayName.slice(0, 25), updatedAt, normalized);
  if (info.changes === 0) throw new Error('account not found');
  return { email: normalized, displayName: newDisplayName.slice(0,25), updatedAt };
}

export function getAccountByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const row = db.prepare('SELECT email, display_name, email_verified, created_at FROM accounts WHERE email = ?').get(normalized);
  if (!row) return null;
  return {
    email: row.email,
    displayName: row.display_name,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at
  };
}

export function deleteAccountByEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const info = db.prepare('DELETE FROM accounts WHERE email = ?').run(normalized);
  return info.changes > 0;
}

// convenience: list accounts (without password_hash)
export function listAccounts(opts = { includeHash: false }) {
  if (opts.includeHash) {
    const rows = db.prepare('SELECT email, display_name, password_hash, email_verified, created_at FROM accounts').all();
    return rows;
  }
  const rows = db.prepare('SELECT email, display_name, email_verified, created_at FROM accounts').all();
  return rows.map(r => ({ email: r.email, displayName: r.display_name, emailVerified: !!r.email_verified, createdAt: r.created_at }));
}

export default {
  createAccount,
  authenticate,
  getAccountByEmail,
  updateDisplayName,
  deleteAccountByEmail,
  listAccounts
};