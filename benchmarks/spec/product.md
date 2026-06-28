# Product spec: the "Notes" app (shared by both benchmark apps)

Both `bench-app-next` (Next.js) and `bench-app-gemstack` (Vike + React + `@gemstack/ai-*`) implement the **same product** and the **same HTTP contract**. Equivalence is what makes the comparison fair; the contract is what lets one acceptance script run against both.

## Surface

A single-user notes app:

- **Auth** - email + password sign-in for one seeded user. A session cookie guards the app and the API.
- **CRUD resource: `notes`** - fields `id`, `title`, `body`, `createdAt`. List, create, view, delete.
- **AI feature: summarize** - produce a one-sentence summary of a note's body.
  - GemStack app: via `@gemstack/ai-sdk` (the orchestration layer in reach).
  - Next.js app: a vanilla inline provider call.
  - Both default to a **deterministic stub model** (no network, no API key) so the baseline is reproducible. The stub returns the first sentence of the body, trimmed to <= 140 chars. Real providers are a later, opt-in concern.

## Storage

SQLite via `better-sqlite3` (already allowed in the workspace), one file per app, seeded on first boot. Same schema both sides:

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL
);
```

Seed user: `demo@example.com` / `password`.

## HTTP contract (identical on both apps)

All endpoints return JSON. Auth endpoints set / clear a `session` cookie; protected endpoints require it and return `401` without it.

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| POST | `/api/login` | `{ email, password }` | `200 { ok: true }` + `session` cookie | `401` on bad creds |
| POST | `/api/logout` | - | `200 { ok: true }` | clears cookie |
| GET | `/api/notes` | - | `200 { notes: Note[] }` | newest first |
| POST | `/api/notes` | `{ title, body }` | `201 { note: Note }` | |
| GET | `/api/notes/:id` | - | `200 { note: Note }` | `404` if absent |
| DELETE | `/api/notes/:id` | - | `200 { ok: true }` | |
| POST | `/api/notes/:id/summarize` | - | `200 { note: Note }` | sets `summary` |

`Note` shape: `{ id: number, title: string, body: string, summary: string | null, createdAt: string }`.

## UI

Minimal but real React pages (server-rendered on both): a login page, a notes list (with a create form and per-note delete + summarize buttons), and a note detail page. Parity of surface matters more than polish.

## Baseline = starting commit

The committed state of each app is the Phase 0 **starting point**. Tasks (e.g. `task-001-tags`) ask the agent to extend it; the acceptance script verifies the result against the contract.
