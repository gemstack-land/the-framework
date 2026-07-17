import { Menu } from '@base-ui-components/react/menu'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// The shadcn "base" dropdown menu (built on Base UI, not Radix) — trimmed to what the Start
// form's preset menu needs (#649). Themed with the dashboard's CSS-var tokens (there is no
// --color-popover, so the card surface stands in). Base UI's composition is a `render` prop,
// and item highlight state is `data-highlighted`.

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'start',
  ...props
}: ComponentProps<typeof Menu.Popup> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <Menu.Popup
          className={cn(
            'max-h-[var(--available-height)] min-w-[13rem] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-[var(--color-card-foreground)] shadow-md outline-none',
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-[var(--color-accent)] data-[highlighted]:text-[var(--color-accent-foreground)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-[var(--color-border)]', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn('px-2 py-1.5 text-xs font-semibold text-[var(--color-muted-foreground)]', className)}
      {...props}
    />
  )
}
