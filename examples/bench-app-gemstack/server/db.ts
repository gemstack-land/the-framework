import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(here, '../data/bench.sqlite')

export interface NoteRow {
  id: number
  title: string
  body: string
  summary: string | null
  created_at: string
}

/** Public `Note` shape from the HTTP contract. */
export interface Note {
  id: number
  title: string
  body: string
  summary: string | null
  createdAt: string
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

let _db: Database.Database | null = null

/** Lazily open + migrate + seed the SQLite database (idempotent). */
export function db(): Database.Database {
  if (_db) return _db

  mkdirSync(dirname(DB_PATH), { recursive: true })
  const conn = new Database(DB_PATH)
  conn.pragma('journal_mode = WAL')

  conn.exec(`
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
  `)

  // Seed the single demo user on first boot.
  const seeded = conn.prepare('SELECT 1 FROM users WHERE email = ?').get('demo@example.com')
  if (!seeded) {
    conn.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run('demo@example.com', 'password')
  }

  _db = conn
  return conn
}

export function findUser(email: string, password: string): { id: number } | undefined {
  return db()
    .prepare('SELECT id FROM users WHERE email = ? AND password = ?')
    .get(email, password) as { id: number } | undefined
}

export function listNotes(): Note[] {
  const rows = db().prepare('SELECT * FROM notes ORDER BY id DESC').all() as NoteRow[]
  return rows.map(toNote)
}

export function getNote(id: number): Note | undefined {
  const row = db().prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  return row ? toNote(row) : undefined
}

export function createNote(title: string, body: string): Note {
  const createdAt = new Date().toISOString()
  const info = db()
    .prepare('INSERT INTO notes (title, body, summary, created_at) VALUES (?, ?, NULL, ?)')
    .run(title, body, createdAt)
  return getNote(Number(info.lastInsertRowid))!
}

export function deleteNote(id: number): boolean {
  const info = db().prepare('DELETE FROM notes WHERE id = ?').run(id)
  return info.changes > 0
}

export function setSummary(id: number, summary: string): Note | undefined {
  const info = db().prepare('UPDATE notes SET summary = ? WHERE id = ?').run(summary, id)
  if (info.changes === 0) return undefined
  return getNote(id)
}
