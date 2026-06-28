import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionTokenFor, verifyCredentials } from '@/lib/auth';

export async function POST(req: Request) {
  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email : '';
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    // fall through to 401 on malformed body
  }

  const userId = verifyCredentials(email, password);
  if (userId === null) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionTokenFor(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
