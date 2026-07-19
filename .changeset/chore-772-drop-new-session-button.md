---
"@gemstack/framework": patch
---

Drop the navbar `New session` button (#772). The button shipped alongside removing the navbar textarea, but the navbar's shape is still being decided, so it comes out until it lands with the rest of the redesign. The rail's Live row already starts a new session in the selected project, so nothing is lost meanwhile.
