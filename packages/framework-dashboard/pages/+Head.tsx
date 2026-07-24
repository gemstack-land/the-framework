// Load the landing page's typeface (#1118) so the dashboard reads as the same product as
// the-framework.ai: IBM Plex Sans for UI, IBM Plex Mono for code. Same Google Fonts links as
// packages/the-framework.ai/pages/+Head.tsx. Emitted into the prerendered shell's <head>.
export default function Head() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
    </>
  )
}
