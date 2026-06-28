import { getDb } from './db';

export interface Note {
  id: number;
  title: string;
  body: string;
  summary: string | null;
  createdAt: string;
}

interface NoteRow {
  id: number;
  title: string;
  body: string;
  summary: string | null;
  created_at: string;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export function listNotes(): Note[] {
  const rows = getDb()
    .prepare('SELECT * FROM notes ORDER BY id DESC')
    .all() as NoteRow[];
  return rows.map(toNote);
}

export function getNote(id: number): Note | null {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as
    | NoteRow
    | undefined;
  return row ? toNote(row) : null;
}

export function createNote(title: string, body: string): Note {
  const createdAt = new Date().toISOString();
  const info = getDb()
    .prepare('INSERT INTO notes (title, body, summary, created_at) VALUES (?, ?, NULL, ?)')
    .run(title, body, createdAt);
  return getNote(Number(info.lastInsertRowid))!;
}

export function deleteNote(id: number): void {
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
}

export function setSummary(id: number, summary: string): Note | null {
  getDb().prepare('UPDATE notes SET summary = ? WHERE id = ?').run(summary, id);
  return getNote(id);
}
