import type { CSSProperties, MouseEvent } from 'react'
import { DiscordIcon, GitHubIcon } from './icons'
import { DISCORD_URL, GITHUB_URL } from './ui'

const navBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: '#d3c6aa',
  border: '1px solid #4f585e',
  borderRadius: 8,
  padding: '7px 14px',
  fontWeight: 500,
}

function scrollTopClear(e: MouseEvent) {
  e.preventDefault()
  history.replaceState(null, '', window.location.pathname + window.location.search)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

export function TopNav() {
  return (
    <nav
      style={{
        maxWidth: 1120,
        margin: '0 auto',
        padding: '16px clamp(14px, 4vw, 24px)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'clamp(14px, 3vw, 28px)',
        rowGap: 14,
      }}
    >
      <a
        href="#top"
        onClick={scrollTopClear}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          color: '#d3c6aa',
          fontWeight: 600,
          fontSize: 17,
          whiteSpace: 'nowrap',
        }}
      >
        <img src="/assets/logo.svg" alt="The Framework logo" style={{ width: 30, height: 34, display: 'block' }} />
        The Framework
      </a>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'clamp(10px, 2.5vw, 20px)',
          marginLeft: 'auto',
          fontSize: 14.5,
        }}
      >
        <a href={DISCORD_URL} className="nav-btn" style={navBtnStyle}>
          <DiscordIcon width={16} height={13} />
          <span>Discord</span>
        </a>
        <a href={GITHUB_URL} className="nav-btn" style={navBtnStyle}>
          <GitHubIcon size={16} />
          <span>GitHub</span>
        </a>
      </div>
    </nav>
  )
}
