import { type KeyboardEvent, type PointerEvent, type ReactElement, useRef, useState } from 'react'

interface PaneResizeHandleProps {
  /** A concise description of the two panes the divider separates. */
  ariaLabel: string
  value: number
  min: number
  max: number
  defaultValue: number
  onValueChange: (next: number) => void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Small, keyboard-accessible vertical splitter for the desktop workspace.
 * Its visual rule stays subtle; the wider hit target and resize cursor appear
 * on hover, matching standard macOS split-view affordances.
 */
export function PaneResizeHandle({
  ariaLabel,
  value,
  min,
  max,
  defaultValue,
  onValueChange
}: PaneResizeHandleProps): ReactElement {
  const dragStart = useRef<{ pointerId: number; x: number; value: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current
    if (!start || start.pointerId !== event.pointerId) return
    onValueChange(clamp(start.value + event.clientX - start.x, min, max))
  }

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragStart.current?.pointerId !== event.pointerId) return
    updateFromPointer(event)
    dragStart.current = null
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.altKey ? 32 : 8
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = value - step
    if (event.key === 'ArrowRight') next = value + step
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    onValueChange(clamp(next, min, max))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} pixels`}
      tabIndex={0}
      title={`${ariaLabel}. Drag to resize; double-click to reset.`}
      className="tempo-pane-resize-handle"
      data-dragging={isDragging || undefined}
      onPointerDown={(event): void => {
        if (event.button !== 0) return
        event.preventDefault()
        dragStart.current = { pointerId: event.pointerId, x: event.clientX, value }
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsDragging(true)
      }}
      onPointerMove={updateFromPointer}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onDoubleClick={(): void => onValueChange(clamp(defaultValue, min, max))}
      onKeyDown={handleKeyDown}
    />
  )
}
