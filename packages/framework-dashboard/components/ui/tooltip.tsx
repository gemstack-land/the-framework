'use client'
import type { ComponentProps } from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui-components/react/tooltip'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn-style Tooltip on Base UI (already a dep via animate-ui — no Radix pulled
// in). Wrap a group in <TooltipProvider> (shared open/close delay), then per item:
//   <Tooltip><TooltipTrigger render={<Button …/>}>…</TooltipTrigger><TooltipContent>Label</TooltipContent></Tooltip>
const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 6,
  side,
  align,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number
  side?: ComponentProps<typeof TooltipPrimitive.Positioner>['side']
  align?: ComponentProps<typeof TooltipPrimitive.Positioner>['align']
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        sideOffset={sideOffset}
        {...(side ? { side } : {})}
        {...(align ? { align } : {})}
      >
        <TooltipPrimitive.Popup
          className={cn(
            'z-50 rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-md',
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
