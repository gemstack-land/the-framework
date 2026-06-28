import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { listNotes } from '@/lib/notes';
import CreateNoteForm from './create-note-form';
import NoteActions from './note-actions';
import LogoutButton from './logout-button';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect('/login');
  const notes = listNotes();

  return (
    <main>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Notes</h1>
        <LogoutButton />
      </header>

      <CreateNoteForm />

      {notes.length === 0 ? (
        <p style={{ color: '#666' }}>No notes yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {notes.map((note) => (
            <li key={note.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
              <Link href={`/notes/${note.id}`} style={{ fontWeight: 600 }}>
                {note.title}
              </Link>
              <p style={{ margin: '4px 0', color: '#444' }}>{note.body}</p>
              {note.summary && (
                <p style={{ margin: '4px 0', color: '#0a7', fontStyle: 'italic' }}>
                  Summary: {note.summary}
                </p>
              )}
              <small style={{ color: '#999' }}>{note.createdAt}</small>
              <NoteActions id={note.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
