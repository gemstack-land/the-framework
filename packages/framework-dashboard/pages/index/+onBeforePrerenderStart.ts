// A page with a Route Function has no URLs to derive, so name the one that gets prerendered: the
// `/` shell the daemon serves for every path (dashboard/static.ts). Without this the build emits
// no index.html at all.
export default function onBeforePrerenderStart(): string[] {
  return ['/']
}
