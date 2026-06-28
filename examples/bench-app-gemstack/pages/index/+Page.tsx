import { useEffect, useState } from 'react'
import { api, type Note } from '../api.js'

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      setNotes(await api.list())
    } catch {
      window.location.href = '/login'
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    await api.create(title, body)
    setTitle('')
    setBody('')
    await refresh()
  }

  async function onDelete(id: number) {
    await api.remove(id)
    await refresh()
  }

  async function onSummarize(id: number) {
    await api.summarize(id)
    await refresh()
  }

  async function onLogout() {
    await api.logout()
    window.location.href = '/login'
  }

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Notes</h1>
        <button onClick={onLogout}>Log out</button>
      </header>

      <form onSubmit={onCreate} style={{ marginBottom: 24 }}>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ display: 'block', width: '100%', marginBottom: 8 }}
        />
        <textarea
          placeholder="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          style={{ display: 'block', width: '100%', marginBottom: 8 }}
        />
        <button type="submit">Add note</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : notes.length === 0 ? (
        <p>No notes yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notes.map((note) => (
            <li key={note.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <strong>
                <a href={`/note/${note.id}`}>{note.title}</a>
              </strong>
              <p style={{ margin: '4px 0' }}>{note.body}</p>
              {note.summary && (
                <p style={{ margin: '4px 0', color: '#555' }}>
                  <em>Summary: {note.summary}</em>
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onSummarize(note.id)}>Summarize</button>
                <button onClick={() => onDelete(note.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
