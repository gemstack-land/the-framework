import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.BENCH_DB_PATH ?? join(process.cwd(), 'data', 'notes.db');

let db: Database.Database | null = null;

/** Lazily open the single SQLite file and seed it on first boot. */
export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Seed the single demo user once.
  const seeded = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@example.com');
  if (!seeded) {
    db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(
      'demo@example.com',
      'password',
    );
  }

  return db;
}
