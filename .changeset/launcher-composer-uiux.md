---
"@gemstack/framework": minor
---

Dashboard launcher and rail UX pass:

- The prompt editor and its run controls are grouped into one rounded "composer box"; the editor loses its own border and focus ring, and the placeholder and typed text get roomier padding.
- The submit button is a single arrow icon that stays hidden until the prompt has text, then fades in and slides into place, pushing the model select over smoothly (a spinner shows while starting or sending).
- The agent/model select sits just left of the submit button, borderless, with the model shown as selected (the default reads "Default", no separator dot).
- Presets is a borderless slash icon, the options gear is borderless with a smaller count badge, and all controls share one height.
- "Open in editor" moved out of the options gear onto the workspace editor button, which now opens the checkout and picks the preferred editor.
- The right rail holds one fixed width for every tab (no expand on Views/Browser).
- The sessions rail: "New session" is now "New", the "Sessions" heading is replaced by a "Recents" label over the list, the agent logo is smaller, and rows clear the scrollbar.
- The session toolbar drops the copy-branch and copy-session-id buttons, and the branch dirty/clean indicator sits closer to the branch name.
