import { Menu } from '@base-ui-components/react/menu'
import { ChevronRight, Check } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// The shadcn "base" dropdown menu (built on Base UI, not Radix) — trimmed to what the Start
// form's preset + agent/model menus need (#649/#650). Themed with the dashboard's CSS-var tokens
// (there is no --color-popover, so the card surface stands in). Item highlight state is
// `data-highlighted`; an open submenu trigger is `data-popup-open`.

const POPUP_CLASS =
  'max-h-[var(--available-height)] min-w-[13rem] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 text-[var(--color-card-foreground)] shadow-md outline-none'
const ITEM_CLASS =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--color-accent)] data-[highlighted]:text-[var(--color-accent-foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuSub = Menu.SubmenuRoot

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'start',
  ...props
}: ComponentProps<typeof Menu.Popup> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <Menu.Popup className={cn(POPUP_CLASS, className)} {...props} />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(ITEM_CLASS, className)} {...props} />
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  // Keep the menu open when toggling, so several options can be flipped in one pass.
  closeOnClick = false,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(ITEM_CLASS, className)} closeOnClick={closeOnClick} {...props}>
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        <Menu.CheckboxItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  )
}

export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof Menu.SubmenuTrigger>) {
  return (
    <Menu.SubmenuTrigger
      className={cn(ITEM_CLASS, 'justify-between data-[popup-open]:bg-[var(--color-accent)]', className)}
      {...props}
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5 opacity-70" />
    </Menu.SubmenuTrigger>
  )
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Menu.Popup>) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="right" align="start" sideOffset={2} className="z-50 outline-none">
        <Menu.Popup className={cn(POPUP_CLASS, className)} {...props} />
      </Menu.Positioner>
    </Menu.Portal>
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
