// Every path is this page (#784). The dashboard is one page whose address carries the selection
// (`/`, `/{projectId}`, `/{projectId}/{sessionId}`), so a client-side navigation to any of them has
// to resolve here. What this returns is deliberately not read: the shell is prerendered for `/`,
// which freezes the route params baked into it, so the page reads `urlPathname` (lib/use-route.ts).
export default function route(): boolean {
  return true
}
