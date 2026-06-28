// Tiny client-side wrapper over the HTTP contract used by the React pages.
export interface Note {
  id: number
  title: string
  body: string
  summary: string | null
  createdAt: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  async login(email: string, password: string): Promise<void> {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error('Invalid credentials')
  },
  async logout(): Promise<void> {
    await fetch('/api/logout', { method: 'POST' })
  },
  async list(): Promise<Note[]> {
    const { notes } = await json<{ notes: Note[] }>(await fetch('/api/notes'))
    return notes
  },
  async create(title: string, body: string): Promise<Note> {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body }),
    })
    return (await json<{ note: Note }>(res)).note
  },
  async get(id: number): Promise<Note> {
    return (await json<{ note: Note }>(await fetch(`/api/notes/${id}`))).note
  },
  async remove(id: number): Promise<void> {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' })
  },
  async summarize(id: number): Promise<Note> {
    const res = await fetch(`/api/notes/${id}/summarize`, { method: 'POST' })
    return (await json<{ note: Note }>(res)).note
  },
}
