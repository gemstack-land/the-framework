import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { deleteNote, getNote } from '@/lib/notes';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const note = getNote(Number(id));
  if (!note) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ note });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  deleteNote(Number(id));
  return NextResponse.json({ ok: true });
}
