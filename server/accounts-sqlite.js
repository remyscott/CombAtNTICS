// accounts-sqlite.js
import db from './db.js';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const ALLOWED_ROLES = ['player', 'mod', 'admin'];

function now() { return Date.now(); }

function ensureRolesColumn() {
  try {
    const columns = db.prepare(`PRAGMA table_info(accounts)`).all();
    const hasRoles = columns.some((col) => col.name === 'roles');
    if (hasRoles) return;

    db.prepare(`ALTER TABLE accounts ADD COLUMN roles TEXT DEFAULT 'player'`).run();
    const rows = db.prepare(`SELECT username, role FROM accounts`).all();
    const update = db.prepare(`UPDATE accounts SET roles = ? WHERE username = ?`);
    for (const row of rows) {
      update.run(row.role || 'player', row.username);
    }
  } catch (e) {
    console.warn('Failed to ensure roles column exists', e);
  }
}

ensureRolesColumn();
function ensureKeybindsColumn() {
  try {
    const columns = db.prepare(`PRAGMA table_info(accounts)`).all();
    const hasKeybinds = columns.some((col) => col.name === 'keybinds');
    if (hasKeybinds) return;

    db.prepare(`ALTER TABLE accounts ADD COLUMN keybinds TEXT`).run();
    // existing rows will have NULL keybinds — that's fine
  } catch (e) {
    console.warn('Failed to ensure keybinds column exists', e);
  }
}

ensureKeybindsColumn();
function normalizeUsername(username) { return String(username || '').trim().toLowerCase(); }
function parseRoles(rawRoles) {
  if (!rawRoles) return ['player'];
  if (Array.isArray(rawRoles)) rawRoles = rawRoles.join(',');
  const parsed = String(rawRoles)
    .split(',')
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean);
  const uniqueRoles = [...new Set(parsed)];
  return uniqueRoles.length > 0 ? uniqueRoles : ['player'];
}
function serializeRoles(roles) {
  return parseRoles(roles).join(',');
}
function ensureRoles(rawRoles) {
  const normalizedRoles = parseRoles(rawRoles);
  const invalid = normalizedRoles.find((role) => !ALLOWED_ROLES.includes(role));
  if (invalid) throw new Error(`invalid role: ${invalid}`);
  return normalizedRoles;
}

export async function createAccount(username, plainPassword, displayName = 'NoName') {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('username required');
  if (!/^[a-zA-Z0-9]+$/.test(normalized)) throw new Error('username must contain only alphanumeric characters');
  if (username.length > 15) throw new Error('username must be at most 15 characters');
  if (!plainPassword) throw new Error('password required');
  const exists = db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(normalized);
  if (exists) throw new Error('username exists');

  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  const created = now();

  const envAdmins = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  const assignedRoles = envAdmins.includes(normalized) ? ['player', 'admin'] : ['player'];

  const stmt = db.prepare(`
    INSERT INTO accounts (username, password_hash, display_name, roles, created_at)
    VALUES (@username, @password_hash, @display_name, @roles, @created_at)
  `);

  stmt.run({
    username: normalized,
    password_hash: hash,
    display_name: displayName,
    roles: serializeRoles(assignedRoles),
    created_at: created
  });

  return { username: normalized, displayName, roles: assignedRoles, createdAt: created };
}

export async function authenticate(username, plainPassword) {
  const normalized = normalizeUsername(username);
  const row = db.prepare('SELECT username, password_hash, display_name, email_verified, created_at, roles, keybinds FROM accounts WHERE username = ?').get(normalized);
  if (!row) return null;
  const ok = await bcrypt.compare(plainPassword, row.password_hash);
  if (!ok) return null;
  return {
    username: row.username,
    displayName: row.display_name,
    emailVerified: !!row.email_verified,
    roles: parseRoles(row.roles || row.role),
    keybinds: (row.keybinds && (() => { try { return JSON.parse(row.keybinds); } catch { return {}; } })()) || {},
    createdAt: row.created_at
  };
}

export async function updateDisplayName(username, newDisplayName) {
  const normalized = normalizeUsername(username);
  const updatedAt = now();
  const stmt = db.prepare(`UPDATE accounts SET display_name = ?, updated_at = ? WHERE username = ?`);
  const info = stmt.run(newDisplayName.slice(0, 25), updatedAt, normalized);
  if (info.changes === 0) throw new Error('account not found');
  return { username: normalized, displayName: newDisplayName.slice(0, 25), updatedAt };
}

export function getAccountByUsername(username) {
  const normalized = normalizeUsername(username);
  const row = db.prepare('SELECT username, display_name, email_verified, created_at, roles, keybinds FROM accounts WHERE username = ?').get(normalized);
  if (!row) return null;
  return {
    username: row.username,
    displayName: row.display_name,
    emailVerified: !!row.email_verified,
    roles: parseRoles(row.roles || row.role),
    keybinds: (row.keybinds && (() => { try { return JSON.parse(row.keybinds); } catch { return {}; } })()) || {},
    createdAt: row.created_at
  };
}

export function deleteAccountByUsername(username) {
  const normalized = normalizeUsername(username);
  const info = db.prepare('DELETE FROM accounts WHERE username = ?').run(normalized);
  return info.changes > 0;
}

export function listAccounts(opts = { includeHash: false }) {
  if (opts.includeHash) {
    const rows = db.prepare('SELECT username, display_name, password_hash, email_verified, created_at, roles, keybinds FROM accounts').all();
    return rows;
  }
  const rows = db.prepare('SELECT username, display_name, email_verified, created_at, roles, keybinds FROM accounts').all();
  return rows.map((r) => ({
    username: r.username,
    displayName: r.display_name,
    emailVerified: !!r.email_verified,
    roles: parseRoles(r.roles || r.role),
    keybinds: (r.keybinds && (() => { try { return JSON.parse(r.keybinds); } catch { return {}; } })()) || {},
    createdAt: r.created_at
  }));
}

export async function updateRole(username, newRole) {
  const normalized = normalizeUsername(username);
  const roles = ensureRoles(newRole);
  const stmt = db.prepare(`UPDATE accounts SET roles = ?, updated_at = ? WHERE username = ?`);
  const updatedAt = now();
  const info = stmt.run(serializeRoles(roles), updatedAt, normalized);
  if (info.changes === 0) throw new Error('account not found');
  return { username: normalized, roles, updatedAt };
}

export async function updateKeybinds(username, bindings) {
  const normalized = normalizeUsername(username);
  const updatedAt = now();
  const json = JSON.stringify(bindings || {});
  const stmt = db.prepare(`UPDATE accounts SET keybinds = ?, updated_at = ? WHERE username = ?`);
  const info = stmt.run(json, updatedAt, normalized);
  if (info.changes === 0) throw new Error('account not found');
  return { username: normalized, keybinds: bindings || {}, updatedAt };
}

export default {
  createAccount,
  authenticate,
  getAccountByUsername,
  updateDisplayName,
  deleteAccountByUsername,
  listAccounts,
  updateRole
  ,
  updateKeybinds
};