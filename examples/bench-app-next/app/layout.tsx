import type { ReactNode } from 'react';

export const metadata = {
  title: 'Notes (Next.js baseline)',
  description: 'GemStack AI benchmark - vanilla Next.js Notes app',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 720,
          margin: '2rem auto',
          padding: '0 1rem',
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
