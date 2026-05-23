// db.js
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'database.sqlite');

// ensure data directory exists (simple)
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Pragmas for durability and concurrency
db.pragma('journal_mode = WAL');        // better concurrent readers/writers
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Run migrations programmatically (idempotent)
const migrationSQL = fs.readFileSync(path.resolve('migrations','001-create-accounts.sql'), 'utf8');
db.exec(migrationSQL);

export default db;