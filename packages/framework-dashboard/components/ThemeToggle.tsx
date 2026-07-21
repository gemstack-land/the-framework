import { Monitor, Sun, Moon, Check, type LucideIcon } from 'lucide-react'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'

// The appearance control (#754). The theme has been switchable since #725, but it lived inside the
// per-run options gear: an app-wide setting filed under one run's options, and absent entirely on a
// screen showing only the navbar. Nobody found it. It belongs in the header, which is always there.
//
// Same `preferences.theme` the rest of the app reads (LayoutDefault resolves it and toggles `dark`
// on <html>), so this is a second surface onto one setting, not a second setting.

/** The theme choices, in trigger order; `system` is the default. */
const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function ThemeToggle() {
  const preferences = usePreferences()
  const theme = themePreference(preferences)
  // The trigger wears the current choice, so the header says which theme is on without opening it.
  const current = THEME_OPTIONS.find(t => t.value === theme) ?? THEME_OPTIONS[0]!
  const Current = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0 text-muted-foreground')}
        title={`Theme: ${current.label}`}
        aria-label="Theme"
      >
        <Current className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map(t => {
          const Icon = t.icon
          return (
            <DropdownMenuItem
              key={t.value}
              // Keep the menu open so the theme visibly changes underneath the pick.
              closeOnClick={false}
              onClick={() => updatePreferences({ theme: t.value })}
              title={`${t.label} theme`}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', t.value === theme ? 'opacity-100' : 'opacity-0')} />
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {t.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
