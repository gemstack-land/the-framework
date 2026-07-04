---
'@gemstack/ai-autopilot': minor
---

Compose vike-themes / vike-layouts for styling and the app shell instead of hand-rolling CSS + nav

After auth, data, and the CRUD/admin UI, the remaining big hand-rolled surface is styling and the app shell: an agent writes its own CSS design system, dark-mode toggle, and layout/nav chrome on every build, and that fresh CSS is the root of the loop's over-polish churn. The new `vike-shell-composer` persona (wired into `vikeExtensionPersonas`) teaches the agent to declare a brand with `defineTheme` and `extends: [themesExt]` (flash-free system dark mode, a picker, and a CSS-variable contract to style against) instead of hand-writing a color system, and to pick a shell with `vike-layouts` (`layout: 'centered' | 'topbar' | 'sidebar'` plus `logo` / cumulative `nav` slots) instead of a hand-written topbar/sidebar. It also notes the one-line `vike-toolbar` install that gives the theme/locale controls a home. No runtime change; the agent stays a black box. Part of #186. Closes #192.
