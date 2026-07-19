---
"@gemstack/framework": patch
---

Replace the navbar textarea with a `New session` button (#772). The sticky top nav carried a second prompt editor next to the launcher's own, so the dashboard had two textareas competing for the same job. The navbar now holds the de-facto standard button instead: it lands on the selected project's launcher with a fresh Context, and that page's single textarea starts the session.
