import { cookies } from 'next/headers';
import { getDb } from './db';

export const SESSION_COOKIE = 'session';

interface UserRow {
  id: number;
  email: string;
  password: string;
}

/** Verify credentials against the seeded user; returns the user id or null. */
export function verifyCredentials(email: string, password: string): number | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email) as UserRow | undefined;
  if (!row || row.password !== password) return null;
  return row.id;
}

/** Session token = the user id (single-user app). */
export function sessionTokenFor(userId: number): string {
  return String(userId);
}

function userExists(id: number): boolean {
  return !!getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
}

/** Read the session cookie and confirm it maps to a real user. */
export async function getCurrentUserId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = Number(token);
  if (!Number.isInteger(id) || !userExists(id)) return null;
  return id;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUserId()) !== null;
}
