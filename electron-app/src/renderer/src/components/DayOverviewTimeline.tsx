import { type KeyboardEvent, type MouseEvent, useMemo, useState } from 'react'
import type { Category } from 'shared'
import { useAuth } from '../contexts/AuthContext'
import { toast } from '../hooks/use-toast'
import type { ActivitySessionBlock } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import type { DayOverview, DayOverviewState } from '../lib/dayOverview'
import { cn } from '../lib/utils'
import { trpc } from '../utils/trpc'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

interface DayOverviewTimelineProps {
  overview: DayOverview
  /** Current time when the shown day is today, used for the "now" marker. */
  nowMs?: number | null
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
  categories: Category[]
  refetchEvents: () => void
}

interface ClassifyMenu {
  x: number
  y: number
  session: ActivitySessionBlock
}

// A segment wide enough for a readable label: about seven minutes of an hour.
const LABEL_MIN_WIDTH = 0.12
const MAX_ROW_HEIGHT = 32
const LEGEND: DayOverviewState[] = ['focused', 'distracted', 'uncertain']

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const STATE_LABEL: Record<DayOverviewState, string> = {
  focused: 'Focused',
  distracted: 'Distracted',
  uncertain: 'Uncertain'
}

/** The whole tracked day as one hour per row, sized to fit without scrolling. */
export default function DayOverviewTimeline({
  overview,
  nowMs,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession,
  categories,
  refetchEvents
}: DayOverviewTimelineProps) {
  const { token } = useAuth()
  const trpcUtils = trpc.useUtils()
  const [menu, setMenu] = useState<ClassifyMenu | null>(null)
  // Productive categories first, so the likely choice is at the top of the menu.
  const classifyChoices = useMemo(
    () => [...categories].sort((a, b) => Number(b.isProductive) - Number(a.isProductive)),
    [categories]
  )
  const classify = trpc.activeWindowEvents.recategorizeBlock.useMutation({
    onSuccess: (result, variables) => {
      const category = categories.find((item) => item._id === variables.newCategoryId)
      const total = result.updatedCount + result.retroactiveCount
      toast({
        title: `Marked as ${category?.name ?? 'the selected category'}`,
        description:
          result.retroactiveCount > 0
            ? `Also updated ${result.retroactiveCount} other uncertain ${result.retroactiveCount === 1 ? 'moment' : 'moments'} from this app in the same focus session.`
            : `Updated ${total} ${total === 1 ? 'moment' : 'moments'}.`
      })
      refetchEvents()
      void trpcUtils.activeWindowEvents.getLatestEvent.invalidate()
      void trpcUtils.analytics.getPeriod.invalidate()
      void window.api?.refreshCurrentActivity()
    },
    onError: (error) =>
      toast({
        title: 'Could not classify activity',
        description: error.message,
        variant: 'destructive'
      })
  })

  const openClassifyMenu = (
    event: MouseEvent<HTMLButtonElement>,
    session: ActivitySessionBlock
  ) => {
    event.preventDefault()
    // Keyboard invocations (Shift+F10, the Menu key) report 0,0; anchor those to the block.
    const box = event.currentTarget.getBoundingClientRect()
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    setMenu({
      x: fromKeyboard ? box.left : event.clientX,
      y: fromKeyboard ? box.bottom : event.clientY,
      session
    })
  }

  const classifySession = (session: ActivitySessionBlock, categoryId: string) => {
    if (!token) return
    classify.mutate({
      token,
      eventIds: session.eventIds,
      newCategoryId: categoryId,
      correctionActionId: crypto.randomUUID(),
      rememberExactMatch: true,
      applyToSession: true
    })
  }
  // Arrow keys step through blocks in time order, matching list navigation in
  // native macOS views; Tab still visits every block.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-overview-segment]')
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index === -1) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? Math.max(0, index - 1)
            : Math.min(buttons.length - 1, index + 1)
    buttons[next]?.focus()
  }

  return (
    <TooltipProvider delayDuration={250}>
      <section className="tempo-glass-card tempo-hours" aria-label="Hour by hour">
        <div className="tempo-hours-heading">
          <h3>Hour by hour</h3>
          <div className="tempo-hours-legend">
            {LEGEND.filter((state) => state !== 'uncertain' || overview.uncertainMs > 0).map(
              (state) => (
                <span key={state}>
                  <span className={cn('tempo-day-dot', `is-${state}`)} aria-hidden="true" />
                  {STATE_LABEL[state]}
                </span>
              )
            )}
          </div>
        </div>
        <div className="tempo-hours-ruler" aria-hidden="true">
          <span />
          <div>
            <span style={{ left: '0%' }}>:00</span>
            <span style={{ left: '25%' }}>:15</span>
            <span style={{ left: '50%' }}>:30</span>
            <span style={{ left: '75%' }}>:45</span>
          </div>
          <span>Focused</span>
        </div>
        <div
          className={cn('tempo-hours-grid', selectedSessionId && 'has-selection')}
          role="list"
          aria-label="Tracked activity by hour"
          style={{
            gridTemplateRows: `repeat(${overview.rows.length}, minmax(20px, ${MAX_ROW_HEIGHT}px))`
          }}
          onKeyDown={handleKeyDown}
        >
          {overview.rows.map((row, rowIndex) => {
            const hourEndMs = overview.rows[rowIndex + 1]?.hourStartMs ?? overview.endMs
            const nowOffset =
              nowMs && nowMs >= row.hourStartMs && nowMs < hourEndMs
                ? (nowMs - row.hourStartMs) / (hourEndMs - row.hourStartMs)
                : null
            return (
              <div
                key={row.hourStartMs}
                role="listitem"
                className={cn('tempo-hours-row', row.segments.length === 0 && 'is-empty')}
                aria-label={`${timeLabel(row.hourStartMs)}: ${formatDuration(row.focusedMs)} focused, ${formatDuration(row.distractedMs)} distracted${row.uncertainMs ? `, ${formatDuration(row.uncertainMs)} uncertain` : ''}, ${formatDuration(row.idleMs)} idle`}
              >
                <time
                  className="tempo-hours-hour"
                  dateTime={new Date(row.hourStartMs).toISOString()}
                >
                  {timeLabel(row.hourStartMs)}
                </time>
                <div className="tempo-hours-track">
                  {row.segments.map((segment) => {
                    const { session } = segment
                    const selected = selectedSessionId === session.id
                    const related = !selected && selectedActivityKey === session.displayKey
                    return (
                      <Tooltip key={`${session.id}:${segment.startMs}`}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            data-overview-segment
                            className={cn(
                              'tempo-hours-segment',
                              `is-${segment.state}`,
                              selected && 'is-selected',
                              related && 'is-related',
                              // A session that crosses the hour reads as one bar
                              // continuing on the next row.
                              +session.startTime < segment.startMs && 'continues-before',
                              +session.endTime > segment.endMs && 'continues-after'
                            )}
                            style={{
                              left: `${segment.offset * 100}%`,
                              width: `${segment.width * 100}%`
                            }}
                            onClick={() => onSelectSession(session)}
                            onContextMenu={
                              segment.state === 'uncertain'
                                ? (event) => openClassifyMenu(event, session)
                                : undefined
                            }
                            aria-pressed={selected}
                            aria-label={`${session.label}, ${session.ownerName}. ${timeLabel(+session.startTime)} to ${timeLabel(+session.endTime)}, ${formatDuration(session.activeDurationMs)} ${STATE_LABEL[segment.state].toLowerCase()}. Select activity.${segment.state === 'uncertain' ? ' Open the context menu to classify it.' : ''}`}
                          >
                            {segment.width >= LABEL_MIN_WIDTH && (
                              <span className="tempo-hours-label">{session.label}</span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="w-60 p-3">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {session.label}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {session.ownerName}
                            {session.categoryName ? ` · ${session.categoryName}` : ''}
                          </p>
                          <div className="tempo-hours-tip-row">
                            <span>
                              <span
                                className={cn('tempo-day-dot', `is-${segment.state}`)}
                                aria-hidden="true"
                              />
                              {STATE_LABEL[segment.state]}
                            </span>
                            <span className="tabular-nums">
                              {timeLabel(+session.startTime)}–{timeLabel(+session.endTime)} ·{' '}
                              {formatDuration(session.activeDurationMs)}
                            </span>
                          </div>
                          {segment.state === 'uncertain' && (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                              Right-click to classify.
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                  {nowOffset !== null && (
                    <span
                      className="tempo-day-now"
                      style={{ left: `${nowOffset * 100}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span className="tempo-hours-total">
                  {row.focusedMs >= 60_000 ? formatDuration(row.focusedMs) : '–'}
                </span>
              </div>
            )
          })}
        </div>
        {overview.uncertainMs > 0 && (
          <p className="tempo-hours-hint">Right-click an amber block to classify it.</p>
        )}
        <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed h-0 w-0"
              style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-52"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuLabel className="max-w-64 truncate text-xs font-medium">
              Classify “{menu?.session.label}”
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {classifyChoices.map((category) => (
              <DropdownMenuItem
                key={category._id}
                onSelect={() => menu && classifySession(menu.session, category._id)}
              >
                <span
                  className={cn(
                    'tempo-day-dot',
                    category.isProductive ? 'is-focused' : 'is-distracted'
                  )}
                  aria-hidden="true"
                />
                <span className="flex-1">{category.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {category.isProductive ? 'Productive' : 'Unproductive'}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <p className="max-w-64 px-2 py-1 text-[11px] text-muted-foreground">
              Also applies to other uncertain time from {menu?.session.ownerName} in the same focus
              session.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
    </TooltipProvider>
  )
}
