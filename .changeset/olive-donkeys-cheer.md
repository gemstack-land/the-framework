---
'@gemstack/framework': minor
---

Dashboard: the session view holds still. A run ending used to swap the whole page for a different one — the action bar blanked, the output was replaced by "Loading session…", the run overview disappeared and the composer was rebuilt. Live and finished are now the same view, so only what the bar, feed and composer say changes. The action bar is one row at any width (the branch truncates, the least important facts drop out, the buttons never wrap under it), and the composer no longer vanishes on a session that ended without a resumable id: it stays and starts a new session instead.
