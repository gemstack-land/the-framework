import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { createNote, listNotes } from '@/lib/notes';

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ notes: listNotes() });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let title = '';
  let body = '';
  try {
    const json = await req.json();
    title = typeof json?.title === 'string' ? json.title : '';
    body = typeof json?.body === 'string' ? json.body : '';
  } catch {
    // fall through to validation
  }

  if (!title || !body) {
    return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
  }

  return NextResponse.json({ note: createNote(title, body) }, { status: 201 });
}
