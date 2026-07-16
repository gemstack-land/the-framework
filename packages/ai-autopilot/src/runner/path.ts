import { RunnerError } from './types.js'

// The workspace path rules, in one place. Every runner took a copy of these, and
// the copies' own comments carried the invariant in prose ("matches LocalFs/FakeFs")
// — which is the tell that they were required to agree and nothing made them.
// It matters most for the fake: it is the test double for the real runners, so a
// drift there means tests passing against something production does not do.

/**
 * Normalize a workspace path to a canonical relative form: drop a leading `./`
 * or `/` (a path is always workspace-relative, never host-absolute) and any
 * trailing slashes.
 */
export function norm(path: string): string {
  return path.replace(/^\.?\/+/, '').replace(/\/+$/, '')
}

/**
 * Walk `path` into the segments it names under the workspace root, rejecting any
 * that climbs out of it — the guard that keeps an agent's writes inside its own
 * workspace.
 *
 * `.` and empty segments are dropped; `..` pops the segment before it, and
 * throws once there is nothing left to pop. So `a/../b` is `b` and `a/../../b`
 * is an escape. An empty result means the path named the workspace root itself,
 * which callers render their own way.
 *
 * This is the container/browser form, which has no real filesystem to resolve
 * against. `LocalRunner` deliberately does not use it: it has a real root, so it
 * resolves against it and asks `node:path` whether the result stayed inside,
 * which also catches what the host resolves differently (symlinks, `..` through
 * a link). Two implementations on purpose, not a copy left behind.
 */
export function safeSegments(path: string): string[] {
  const parts: string[] = []
  for (const seg of norm(path).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) throw new RunnerError(`path escapes the workspace: ${path}`)
      parts.pop()
    } else parts.push(seg)
  }
  return parts
}
