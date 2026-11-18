import { MouseEvent, ReactElement, ReactNode, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'

export type MenuAnchor = { x: number; y: number }

/** Opens one menu either at the pointer (right-click) or under a button. */
export function useMenuAnchor() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  return {
    anchor,
    close: () => setAnchor(null),
    openAtPointer: (event: MouseEvent) => {
      event.preventDefault()
      setAnchor({ x: event.clientX, y: event.clientY })
    },
    openBelow: (event: MouseEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: box.left, y: box.bottom + 2 })
    }
  }
}

/**
 * A context menu that appears where it was asked for, as on the Mac. Releasing
 * the right mouse button never chooses an item, so the click that opens the
 * menu cannot trigger whatever happens to appear under the pointer.
 */
export function AnchoredMenu({
  anchor,
  onClose,
  onClosed,
  className,
  children
}: {
  anchor: MenuAnchor | null
  onClose: () => void
  /** Called after the menu closed, to hand keyboard focus back. */
  onClosed?: () => void
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <DropdownMenu open={Boolean(anchor)} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: anchor?.x ?? 0,
            top: anchor?.y ?? 0,
            width: 0,
            height: 0,
            pointerEvents: 'none'
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={2}
        className={className}
        onPointerUpCapture={(event) => {
          if (event.button === 2) event.stopPropagation()
        }}
        onContextMenu={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onClosed?.()
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
