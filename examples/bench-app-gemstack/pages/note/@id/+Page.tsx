import { useEffect, useState } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { api, type Note } from '../../api.js'

export default function NoteDetailPage() {
  const pageContext = usePageContext()
  const id = Number(pageContext.routeParams!.id)
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setNote(await api.get(id))
    } catch {
      setError('Note not found (or you are signed out).')
    }
  }

  useEffect(() => {
    void refresh()
  }, [id])

  async function onSummarize() {
    await api.summarize(id)
    await refresh()
  }

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <p>
        <a href="/">← Back to notes</a>
      </p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {note && (
        <article>
          <h1>{note.title}</h1>
          <p style={{ color: '#888' }}>{new Date(note.createdAt).toLocaleString()}</p>
          <p>{note.body}</p>
          {note.summary ? (
            <p style={{ color: '#555' }}>
              <em>Summary: {note.summary}</em>
            </p>
          ) : (
            <button onClick={onSummarize}>Summarize</button>
          )}
        </article>
      )}
    </main>
  )
}
