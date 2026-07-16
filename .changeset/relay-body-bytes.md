---
'@gemstack/framework': patch
---

Fix the relay's publish-body reader corrupting multibyte payloads and mis-applying its size cap. It decoded each TCP chunk independently (`body += chunk`), so a multibyte UTF-8 codepoint split across a chunk boundary decoded to replacement characters; and it compared the running string's `.length` (UTF-16 code units) against `maxBodyBytes`, so the cap was wrong for any non-ASCII body. It now accumulates raw `Buffer`s, caps on the byte count, and decodes once at the end.
