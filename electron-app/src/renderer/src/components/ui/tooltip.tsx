import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'
import { motion } from 'framer-motion'

import { cn } from '../../lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, ref) => {
  return (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md origin-[--radix-tooltip-content-transform-origin]',
        className
      )}
      {...props}
    >
      <motion.div
        initial={{
          opacity: 0,
          scale: 0.96,
          y: -2
        }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0
        }}
        exit={{
          opacity: 0,
          scale: 0.96,
          y: -2
        }}
        transition={{
          duration: 0.2,
          ease: [0.16, 1, 0.3, 1], // Custom easing for smooth feel
          scale: {
            duration: 0.15,
            ease: [0.16, 1, 0.3, 1]
          }
        }}
        style={{
          transformOrigin: 'var(--radix-tooltip-content-transform-origin)'
        }}
      >
        {children}
      </motion.div>
    </TooltipPrimitive.Content>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
