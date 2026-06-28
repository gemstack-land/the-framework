import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { getNote } from '@/lib/notes';
import NoteActions from '../../note-actions';

export const dynamic = 'force-dynamic';

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthenticated())) redirect('/login');
  const { id } = await params;
  const note = getNote(Number(id));
  if (!note) notFound();

  return (
    <main>
      <p>
        <Link href="/">&larr; Back to notes</Link>
      </p>
      <h1>{note.title}</h1>
      <p style={{ whiteSpace: 'pre-wrap' }}>{note.body}</p>
      {note.summary && (
        <p style={{ color: '#0a7', fontStyle: 'italic' }}>Summary: {note.summary}</p>
      )}
      <small style={{ color: '#999' }}>{note.createdAt}</small>
      <NoteActions id={note.id} />
    </main>
  );
}
