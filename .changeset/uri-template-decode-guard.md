---
'@gemstack/mcp': patch
---

`matchUriTemplate` no longer lets a percent-encoded separator slip a path traversal past its `[^/]` guard (#968)

The matcher decoded the captured params after the match had already been accepted, so
`file://docs/..%2F..%2F..%2Fetc%2Fpasswd` matched `file://docs/{name}` and handed the
handler `../../../etc/passwd`, while the literal-slash form was correctly rejected. Any
resource handler that treats a template param as a path segment read outside its root.
The guard now applies to the decoded value.

A malformed percent-escape now reports a non-match as well. `decodeURIComponent` was
called unguarded, so a one-character body like `file://docs/%` threw a `URIError` out of
the matcher and into the `resources/read` template loop, where a URI that simply does not
match should fall through cleanly to the next template.

The same pass escapes the literal parts of the template before they reach the `RegExp`.
A `.` in a template used to match any character (`weather://a.b/{city}` matched
`weather://aXb/paris`), and a literal `(` created a capture group that shifted every
param onto the wrong value. Templates without regex metacharacters behave exactly as
before.
