'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function CreateNoteForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (res.ok) {
      setTitle('');
      setBody('');
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, margin: '1rem 0' }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Body"
        rows={3}
        required
      />
      <button type="submit" style={{ justifySelf: 'start' }}>
        Add note
      </button>
    </form>
  );
}
