import { MessageSquare, MessageSquareOff } from 'lucide-react'
import { usePreferences, updatePreferences, discordEnabled } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'

// The Discord notifications toggle in the shell header (#627), beside the browser bell. Unlike
// the bell (default on, gated on a browser permission), Discord is default off and reaches you
// with no dashboard open, so it is opt-in. The other gate is the daemon's `DISCORD_WEBHOOK` env
// var — the toggle can't see it, so the tooltip names it: this only says *whether* to notify,
// the webhook is *where*.
export function DiscordToggle() {
  const preferences = usePreferences()
  const enabled = discordEnabled(preferences)
  const title = enabled
    ? 'Discord notifications on — click to mute (needs DISCORD_WEBHOOK set on the daemon)'
    : 'Discord notifications off — click to turn on (needs DISCORD_WEBHOOK set on the daemon)'

  return (
    <button
      type="button"
      onClick={() => updatePreferences({ notifyDiscord: !enabled })}
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      className={cn('rounded-md p-1.5 hover:bg-accent', enabled ? 'text-foreground' : 'text-muted-foreground')}
    >
      {enabled ? <MessageSquare className="h-4 w-4" /> : <MessageSquareOff className="h-4 w-4" />}
    </button>
  )
}
