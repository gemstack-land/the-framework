import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import LoginForm from './login-form';

export default async function LoginPage() {
  if (await isAuthenticated()) redirect('/');
  return (
    <main>
      <h1>Sign in</h1>
      <p style={{ color: '#666' }}>
        Demo user: <code>demo@example.com</code> / <code>password</code>
      </p>
      <LoginForm />
    </main>
  );
}
