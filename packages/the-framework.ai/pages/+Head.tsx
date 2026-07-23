// Extra <head> tags. vike-react already renders title/description/favicon from
// +config.ts — including og:title/og:description — so only add what's missing.
export default function Head() {
  return (
    <>
      <meta property="og:url" content="https://the-framework.ai/" />
      <meta property="og:type" content="website" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
    </>
  )
}
