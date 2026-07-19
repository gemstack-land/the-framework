// The Framework's mark (#757): the hexknot from https://brillout.github.io/brand-the-framework/.
//
// Six strands, each a flat fill in a neutral ramp. The fills are CSS variables rather than the
// literal hex values so the mark survives a dark background: the shipped ramp runs neutral-950 ->
// neutral-500, which on a dark canvas would sink the leading strands into it. `--logo-1..6` carry
// the brand values in light and a lightened ramp in dark (see `layouts/tailwind.css`).
//
// Not `currentColor` with per-strand opacity, which is the obvious way to make an SVG theme-aware:
// a knot's over/under crossings are literal overlaps, painted in order, so any strand below 100%
// opacity shows the one beneath it through the crossing.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-289 -326 578 651.9"
      className={className}
      role="img"
      aria-label="The Framework"
    >
      <path
        fill="var(--logo-1)"
        d="M-160 -166.3 A10 10 0 0 0 -175 -174.9 L-234 -140.9 A10 10 0 0 0 -239 -132.2 L-239 34.1 A10 10 0 0 0 -234 42.7 L-72 136.3 A10 10 0 0 0 -62 136.3 L-21 112.6 A10 10 0 0 0 -21 95.3 L-173 7.5 A10 10 0 0 1 -178 -1.2 L-178 -97 A10 10 0 0 1 -173 -105.7 L-165 -110.3 A10 10 0 0 0 -160 -118.9 Z"
      />
      <path
        fill="var(--logo-2)"
        d="M64 -221.7 A10 10 0 0 0 64 -239 L5 -273.1 A10 10 0 0 0 -5 -273.1 L-149 -189.9 A10 10 0 0 0 -154 -181.3 L-154 5.8 A10 10 0 0 0 -149 14.4 L-108 38.1 A10 10 0 0 0 -93 29.4 L-93 -146.1 A10 10 0 0 1 -88 -154.7 L-5 -202.6 A10 10 0 0 1 5 -202.6 L13 -198 A10 10 0 0 0 23 -198 Z"
      />
      <path
        fill="var(--logo-3)"
        d="M224 -55.4 A10 10 0 0 0 239 -64.1 L239 -132.2 A10 10 0 0 0 234 -140.9 L90 -224 A10 10 0 0 0 80 -224 L-82 -130.5 A10 10 0 0 0 -87 -121.8 L-87 -74.5 A10 10 0 0 0 -72 -65.8 L80 -153.6 A10 10 0 0 1 90 -153.6 L173 -105.7 A10 10 0 0 1 178 -97 L178 -87.8 A10 10 0 0 0 183 -79.1 Z"
      />
      <path
        fill="var(--logo-4)"
        d="M160 166.3 A10 10 0 0 0 175 174.9 L234 140.9 A10 10 0 0 0 239 132.2 L239 -34.1 A10 10 0 0 0 234 -42.7 L72 -136.3 A10 10 0 0 0 62 -136.3 L21 -112.6 A10 10 0 0 0 21 -95.3 L173 -7.5 A10 10 0 0 1 178 1.2 L178 97 A10 10 0 0 1 173 105.7 L165 110.3 A10 10 0 0 0 160 118.9 Z"
      />
      <path
        fill="var(--logo-5)"
        d="M-64 221.7 A10 10 0 0 0 -64 239 L-5 273.1 A10 10 0 0 0 5 273.1 L149 189.9 A10 10 0 0 0 154 181.3 L154 -5.8 A10 10 0 0 0 149 -14.4 L108 -38.1 A10 10 0 0 0 93 -29.4 L93 146.1 A10 10 0 0 1 88 154.7 L5 202.6 A10 10 0 0 1 -5 202.6 L-13 198 A10 10 0 0 0 -23 198 Z"
      />
      <path
        fill="var(--logo-6)"
        d="M-224 55.4 A10 10 0 0 0 -239 64.1 L-239 132.2 A10 10 0 0 0 -234 140.9 L-90 224 A10 10 0 0 0 -80 224 L82 130.5 A10 10 0 0 0 87 121.8 L87 74.5 A10 10 0 0 0 72 65.8 L-80 153.6 A10 10 0 0 1 -90 153.6 L-173 105.7 A10 10 0 0 1 -178 97 L-178 87.8 A10 10 0 0 0 -183 79.1 Z"
      />
    </svg>
  )
}
