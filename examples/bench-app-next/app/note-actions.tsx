'use client';

import { useRouter } from 'next/navigation';

export default function NoteActions({ id }: { id: number }) {
  const router = useRouter();

  async function summarize() {
    await fetch(`/api/notes/${id}/summarize`, { method: 'POST' });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button type="button" onClick={summarize}>
        Summarize
      </button>
      <button type="button" onClick={remove} style={{ color: 'crimson' }}>
        Delete
      </button>
    </div>
  );
}
