import { type KeyboardEvent, useMemo } from 'react'
import type { ActivitySessionBlock } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { buildDayOverview, type DayOverviewState } from '../lib/dayOverview'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

interface DayOverviewTimelineProps {
  date: Date
  sessions: ActivitySessionBlock[]
  selectedSessionId: string | null
  selectedActivityKey: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
}

// A segment wide enough for a readable label: about seven minutes of an hour.
const LABEL_MIN_WIDTH = 0.12
const MAX_ROW_HEIGHT = 34

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const STATE_LABEL: Record<DayOverviewState, string> = {
  focused: 'Focused',
  distracted: 'Distracted',
  uncertain: 'Uncertain'
}

/** The whole tracked day as one hour per row, sized to fit without scrolling. */
export default function DayOverviewTimeline({
  date,
  sessions,
  selectedSessionId,
  selectedActivityKey,
  onSelectSession
}: DayOverviewTimelineProps) {
  const overview = useMemo(() => buildDayOverview(date, sessions), [date, sessions])
  if (!overview) {
    return <div className="tempo-day-empty-state">No tracked activity for this day.</div>
  }

  const elapsed = overview.endMs - overview.startMs
  const totals = [
    { state: 'is-focused', label: 'focused', durationMs: overview.focusedMs },
    { state: 'is-distracted', label: 'distracted', durationMs: overview.distractedMs },
    { state: 'is-uncertain', label: 'uncertain', durationMs: overview.uncertainMs },
    { state: 'is-idle', label: 'idle', durationMs: overview.idleMs }
  ].filter((item) => item.durationMs > 0 || item.state !== 'is-uncertain')

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
      <section className="tempo-day-overview" aria-label="Whole day overview">
        <div className="tempo-day-overview-header">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Whole day</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {timeLabel(overview.startMs)}–{timeLabel(overview.endMs)} ·{' '}
              {formatDuration(overview.focusedMs + overview.distractedMs + overview.uncertainMs)}{' '}
              tracked
            </span>
          </div>
          <div
            className="tempo-day-overview-summary"
            role="img"
            aria-label={totals
              .map((item) => `${formatDuration(item.durationMs)} ${item.label}`)
              .join(', ')}
          >
            {totals.map((item) =>
              item.durationMs > 0 ? (
                <span
                  key={item.state}
                  className={item.state}
                  style={{ width: `${(item.durationMs / elapsed) * 100}%` }}
                />
              ) : null
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {totals.map((item) => (
              <span key={item.state} className="inline-flex items-center gap-1.5">
                <span className={cn('tempo-day-overview-dot', item.state)} aria-hidden="true" />
                <span className="tabular-nums">{formatDuration(item.durationMs)}</span> {item.label}
              </span>
            ))}
          </div>
        </div>
        <div className="tempo-day-overview-ruler" aria-hidden="true">
          <span />
          <div>
            <span style={{ left: '0%' }}>:00</span>
            <span style={{ left: '25%' }}>:15</span>
            <span style={{ left: '50%' }}>:30</span>
            <span style={{ left: '75%' }}>:45</span>
          </div>
        </div>
        <div
          className="tempo-day-overview-grid"
          role="list"
          aria-label="Tracked activity by hour"
          style={{
            gridTemplateRows: `repeat(${overview.rows.length}, minmax(14px, ${MAX_ROW_HEIGHT}px))`
          }}
          onKeyDown={handleKeyDown}
        >
          {overview.rows.map((row) => (
            <div
              key={row.hourStartMs}
              role="listitem"
              className="tempo-day-overview-row"
              aria-label={`${timeLabel(row.hourStartMs)}: ${formatDuration(row.focusedMs)} focused, ${formatDuration(row.distractedMs)} distracted${row.uncertainMs ? `, ${formatDuration(row.uncertainMs)} uncertain` : ''}, ${formatDuration(row.idleMs)} idle`}
            >
              <time
                className="tempo-day-overview-hour"
                dateTime={new Date(row.hourStartMs).toISOString()}
              >
                {timeLabel(row.hourStartMs)}
              </time>
              <div className="tempo-day-overview-track">
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
                            'tempo-day-overview-segment',
                            `is-${segment.state}`,
                            selected && 'is-selected',
                            related && 'is-related'
                          )}
                          style={{
                            left: `${segment.offset * 100}%`,
                            width: `${segment.width * 100}%`
                          }}
                          onClick={() => onSelectSession(session)}
                          aria-pressed={selected}
                          aria-label={`${session.label}, ${session.ownerName}. ${timeLabel(+session.startTime)} to ${timeLabel(+session.endTime)}, ${formatDuration(session.activeDurationMs)} ${STATE_LABEL[segment.state].toLowerCase()}. Select activity.`}
                        >
                          {segment.width >= LABEL_MIN_WIDTH && (
                            <span className="tempo-day-overview-label">{session.label}</span>
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="w-60 p-3">
                        <p className="truncate text-xs font-medium text-foreground">
                          {session.label}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {session.ownerName}
                          {session.categoryName ? ` · ${session.categoryName}` : ''}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={cn('tempo-day-overview-dot', `is-${segment.state}`)}
                              aria-hidden="true"
                            />
                            {STATE_LABEL[segment.state]}
                          </span>
                          <span className="tabular-nums">
                            {timeLabel(+session.startTime)}–{timeLabel(+session.endTime)} ·{' '}
                            {formatDuration(session.activeDurationMs)}
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </TooltipProvider>
  )
}
