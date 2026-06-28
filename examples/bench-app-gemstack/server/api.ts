import { randomUUID } from 'node:crypto'
import type { Express, Request, Response, NextFunction } from 'express'
import { createNote, deleteNote, findUser, getNote, listNotes, setSummary } from './db.js'
import { summarize } from './ai.js'

const COOKIE = 'session'

/** token -> userId. In-memory; fine for a single-process baseline. */
const sessions = new Map<string, number>()

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

function currentUser(req: Request): number | undefined {
  const token = parseCookies(req)[COOKIE]
  if (!token) return undefined
  return sessions.get(token)
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (currentUser(req) === undefined) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  next()
}

/** Register the HTTP contract on an Express app. Returns the app for chaining. */
export function registerApi(app: Express): Express {
  // POST /api/login
  app.post('/api/login', (req: Request, res: Response) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string }
    const user = email && password ? findUser(email, password) : undefined
    if (!user) {
      res.status(401).json({ error: 'invalid credentials' })
      return
    }
    const token = randomUUID()
    sessions.set(token, user.id)
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' })
    res.status(200).json({ ok: true })
  })

  // POST /api/logout
  app.post('/api/logout', (req: Request, res: Response) => {
    const token = parseCookies(req)[COOKIE]
    if (token) sessions.delete(token)
    res.clearCookie(COOKIE, { path: '/' })
    res.status(200).json({ ok: true })
  })

  // GET /api/notes
  app.get('/api/notes', requireAuth, (_req: Request, res: Response) => {
    res.status(200).json({ notes: listNotes() })
  })

  // POST /api/notes
  app.post('/api/notes', requireAuth, (req: Request, res: Response) => {
    const { title, body } = (req.body ?? {}) as { title?: string; body?: string }
    if (typeof title !== 'string' || typeof body !== 'string') {
      res.status(400).json({ error: 'title and body are required' })
      return
    }
    res.status(201).json({ note: createNote(title, body) })
  })

  // GET /api/notes/:id
  app.get('/api/notes/:id', requireAuth, (req: Request, res: Response) => {
    const note = getNote(Number(req.params.id))
    if (!note) {
      res.status(404).json({ error: 'not found' })
      return
    }
    res.status(200).json({ note })
  })

  // DELETE /api/notes/:id
  app.delete('/api/notes/:id', requireAuth, (req: Request, res: Response) => {
    deleteNote(Number(req.params.id))
    res.status(200).json({ ok: true })
  })

  // POST /api/notes/:id/summarize
  app.post('/api/notes/:id/summarize', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id)
    const note = getNote(id)
    if (!note) {
      res.status(404).json({ error: 'not found' })
      return
    }
    const summary = await summarize(note.body)
    res.status(200).json({ note: setSummary(id, summary) })
  })

  return app
}
