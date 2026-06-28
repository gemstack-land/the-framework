import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getNote, setSummary } from '@/lib/notes';
import { summarize } from '@/lib/summarize';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const note = getNote(Number(id));
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const updated = setSummary(note.id, summarize(note.body));
  return NextResponse.json({ note: updated });
}
