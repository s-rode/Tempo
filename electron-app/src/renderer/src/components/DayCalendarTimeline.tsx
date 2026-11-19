import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ActivitySessionBlock, FocusTimelineRun } from '../lib/activitySessions'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import {
  buildDayCalendarBlocks,
  trackedMs,
  type DayCalendarBlock,
  type DayCalendarState
} from '../lib/dayCalendar'
import { useAppleCalendar } from '../hooks/useAppleCalendar'
import { packCalendarEvents } from '../lib/calendarComparison'
import { calendarPeriod } from '../lib/calendarPeriod'
import { gruvboxCategoryColor } from '../lib/colors'
import { cn } from '../lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

interface DayCalendarTimelineProps {
  date: Date
  sessions: ActivitySessionBlock[]
  runs?: FocusTimelineRun[]
  /** Current time when the shown day is today, for the "now" line. */
  nowMs: number | null
  selectedSessionId: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
  /** Time per planned task, shown above the calendar. */
  taskSummary?: ReactNode
}

const HOUR_MS = 60 * 60 * 1000
const HALF_HOUR_MS = HOUR_MS / 2
const MIN_PX_PER_MINUTE = 1.1
const MAX_PX_PER_MINUTE = 3.2
// Space the rest of the Today page takes above the calendar.
const CHROME_HEIGHT = 300

const STATES: { key: DayCalendarState; label: string; field: keyof DayCalendarBlock }[] = [
  { key: 'focused', label: 'focused', field: 'focusedMs' },
  { key: 'distracted', label: 'distracted', field: 'distractedMs' },
  { key: 'uncertain', label: 'uncertain', field: 'uncertainMs' }
]

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const mixOf = (block: DayCalendarBlock) =>
  STATES.map((state) => ({ ...state, ms: block[state.field] as number })).filter(
    (state) => state.ms >= 1000
  )

const useWindowHeight = () => {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const update = () => setHeight(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return height
}

function BlockDetails({
  block,
  selectedSessionId,
  onSelectSession
}: {
  block: DayCalendarBlock
  selectedSessionId: string | null
  onSelectSession: (session: ActivitySessionBlock) => void
}) {
  const total = trackedMs(block)
  const mix = mixOf(block)
  return (
    <div className="tempo-cal-details">
      <div className="tempo-cal-details-kind">
        {block.kind === 'focus' ? (
          <>
            <span className="is-focus">
              {block.focus?.kind === 'pomodoro' ? 'Pomodoro' : 'Focus session'}
            </span>
            {block.focus && block.focus.adherence !== 'not_enough_activity' && (
              <span className={cn('tempo-cal-adherence', `is-${block.focus.adherence}`)}>
                {block.focus.adherenceLabel}
              </span>
            )}
          </>
        ) : (
          <span>No focus session</span>
        )}
      </div>
      <h4>{block.title}</h4>
      <p className="tempo-cal-details-range">
        {timeLabel(block.startMs)}–{timeLabel(block.endMs)} · {formatDuration(total)} tracked
      </p>
      {total > 0 && (
        <div className="tempo-cal-share" aria-hidden="true">
          {mix.map((state) => (
            <span
              key={state.key}
              className={`is-${state.key}`}
              style={{ width: `${(state.ms / total) * 100}%` }}
            />
          ))}
        </div>
      )}
      <div className="tempo-cal-mix">
        {mix.map((state) => (
          <span key={state.key}>
            <span className={cn('tempo-day-dot', `is-${state.key}`)} aria-hidden="true" />
            {formatDuration(state.ms)} {state.label}
          </span>
        ))}
      </div>
      {block.activities.length > 0 && (
        <>
          <p className="tempo-cal-details-heading">What happened, in order</p>
          <ol className="tempo-cal-activities">
            {block.activities.map((activity) => (
              <li key={`${activity.startMs}:${activity.label}`}>
                <button
                  type="button"
                  className={cn(selectedSessionId === activity.session.id && 'is-selected')}
                  onClick={() => onSelectSession(activity.session)}
                  aria-label={`${timeLabel(activity.startMs)}, ${activity.label}, ${activity.appName}, ${formatDuration(activity.durationMs)} ${activity.state}. Show details.`}
                >
                  <time>{timeLabel(activity.startMs)}</time>
                  <span
                    className={cn('tempo-day-dot', `is-${activity.state}`)}
                    aria-hidden="true"
                  />
                  <span className="tempo-cal-activity-text">
                    <span>{activity.label}</span>
                    <span>
                      {activity.appName}
                      {activity.visits > 1 ? ` · ${activity.visits} visits` : ''}
                    </span>
                  </span>
                  <span className="tempo-cal-activity-duration">
                    {formatDuration(activity.durationMs)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {block.kind === 'free' && (
        <p className="tempo-cal-hint">
          No focus session was running. Start one to give this time a goal.
        </p>
      )}
    </div>
  )
}

/** The day as a calendar column: focus sessions, the tracked time between them, and blank gaps. */
export default function DayCalendarTimeline({
  date,
  sessions,
  runs,
  nowMs,
  selectedSessionId,
  onSelectSession,
  taskSummary
}: DayCalendarTimelineProps) {
  const [openBlockId, setOpenBlockId] = useState<string | null>(null)
  const windowHeight = useWindowHeight()
  const blocks = useMemo(
    () => buildDayCalendarBlocks(sessions, runs, nowMs ?? Date.now()),
    [sessions, runs, nowMs]
  )
  const day = calendarPeriod(date, 'day')
  const { status: calendar } = useAppleCalendar({ startMs: day.startDateMs, endMs: day.endDateMs })
  // Events from the calendars chosen in Settings, beside the blocks.
  const calendarEvents = useMemo(
    () =>
      calendar?.preferences.enabled && calendar.permission === 'granted'
        ? calendar.events.filter(
            (event) =>
              event.startMs < day.endDateMs &&
              event.endMs > day.startDateMs &&
              (calendar.preferences.selectedCalendarIds === null ||
                calendar.preferences.selectedCalendarIds.includes(event.calendarId))
          )
        : [],
    [calendar, day.startDateMs, day.endDateMs]
  )
  const showCalendar = Boolean(calendar?.preferences.enabled && calendar.permission === 'granted')
  const calendarColor = (calendarId: string) =>
    gruvboxCategoryColor(calendar?.calendars.find((item) => item.id === calendarId)?.color)
  const timedEvents = packCalendarEvents(calendarEvents)
  const eventLanes = Math.max(1, ...timedEvents.map((item) => item.lane + 1))
  const allDayEvents = calendarEvents.filter((event) => event.allDay)

  if (!blocks.length) {
    return <div className="tempo-day-empty-state">No tracked activity for this day.</div>
  }

  const visibleEvents = timedEvents.filter(
    ({ event }) => event.endMs > day.startDateMs && event.startMs < day.endDateMs
  )
  const firstMs = Math.max(
    day.startDateMs,
    Math.min(blocks[0].startMs, ...visibleEvents.map(({ event }) => event.startMs))
  )
  const lastMs = Math.min(
    day.endDateMs,
    Math.max(
      ...blocks.map((block) => block.endMs),
      ...visibleEvents.map(({ event }) => event.endMs),
      nowMs ?? 0
    )
  )
  const startMs = Math.floor(firstMs / HALF_HOUR_MS) * HALF_HOUR_MS
  const endMs = Math.max(startMs + HOUR_MS, Math.ceil(lastMs / HOUR_MS) * HOUR_MS)
  const minutes = (endMs - startMs) / 60_000
  const pxPerMinute = Math.min(
    MAX_PX_PER_MINUTE,
    Math.max(MIN_PX_PER_MINUTE, (windowHeight - CHROME_HEIGHT) / minutes)
  )
  const y = (ms: number) => ((ms - startMs) / 60_000) * pxPerMinute
  const hours = Array.from(
    { length: Math.floor((endMs - startMs) / HOUR_MS) + 1 },
    (_, index) => Math.ceil(startMs / HOUR_MS) * HOUR_MS + index * HOUR_MS
  ).filter((hour) => hour <= endMs)

  const totals = blocks.reduce(
    (sum, block) => ({
      focused: sum.focused + block.focusedMs,
      distracted: sum.distracted + block.distractedMs,
      uncertain: sum.uncertain + block.uncertainMs,
      inSessions: sum.inSessions + (block.kind === 'focus' ? block.endMs - block.startMs : 0)
    }),
    { focused: 0, distracted: 0, uncertain: 0, inSessions: 0 }
  )

  // Up and Down step through blocks in time order, like a list on the Mac.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-calendar-block]')
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index === -1) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowUp'
            ? Math.max(0, index - 1)
            : Math.min(buttons.length - 1, index + 1)
    buttons[next]?.focus()
  }

  return (
    <div className="tempo-cal">
      <div className="tempo-cal-summary" aria-label="Day totals">
        <span>
          <span className="tempo-day-dot is-focused" aria-hidden="true" />
          {formatDuration(totals.focused)} focused
        </span>
        <span>
          <span className="tempo-day-dot is-distracted" aria-hidden="true" />
          {formatDuration(totals.distracted)} distracted
        </span>
        {totals.uncertain >= 60_000 && (
          <span>
            <span className="tempo-day-dot is-uncertain" aria-hidden="true" />
            {formatDuration(totals.uncertain)} uncertain
          </span>
        )}
        <span className="tempo-cal-summary-sessions">
          {formatDuration(totals.inSessions)} in focus sessions
        </span>
      </div>
      {taskSummary}
      {showCalendar && allDayEvents.length > 0 && (
        <div className="tempo-cal-allday" aria-label="All-day events">
          {allDayEvents.map((event) => (
            <span
              key={event.id}
              className="tempo-cal-event-chip"
              style={{ '--calendar-color': calendarColor(event.calendarId) } as CSSProperties}
              title={event.title}
            >
              {event.title}
            </span>
          ))}
        </div>
      )}
      <div
        className={cn('tempo-cal-grid', showCalendar && 'has-calendar')}
        role="group"
        aria-label="Your day"
        style={{ height: y(endMs) + 8 }}
        onKeyDown={handleKeyDown}
      >
        {hours.map((hour) => (
          <div key={hour} className="tempo-cal-hour" style={{ top: y(hour) }} aria-hidden="true">
            <span>{timeLabel(hour)}</span>
          </div>
        ))}
        {blocks.map((block) => {
          const top = y(block.startMs)
          const height = Math.max(5, y(block.endMs) - top - 2)
          const span = Math.max(1, block.endMs - block.startMs)
          const total = trackedMs(block)
          const mix = mixOf(block)
          const selected = block.sessions.some((session) => session.id === selectedSessionId)
          const open = openBlockId === block.id
          const kindLabel =
            block.kind === 'free'
              ? 'No focus session'
              : block.focus?.kind === 'pomodoro'
                ? 'Pomodoro'
                : 'Focus session'
          return (
            <Popover
              key={block.id}
              open={open}
              onOpenChange={(next) => setOpenBlockId(next ? block.id : null)}
            >
              <PopoverAnchor asChild>
                <button
                  type="button"
                  data-calendar-block
                  className={cn(
                    'tempo-cal-block',
                    `is-${block.kind}`,
                    (open || selected) && 'is-selected',
                    height < 16 ? 'is-tiny' : height < 46 ? 'is-short' : 'is-tall'
                  )}
                  style={{ top, height }}
                  onClick={() => setOpenBlockId(open ? null : block.id)}
                  aria-expanded={open}
                  aria-haspopup="dialog"
                  aria-label={`${kindLabel}: ${block.title}. ${timeLabel(block.startMs)} to ${timeLabel(block.endMs)}. ${mix.map((state) => `${formatDuration(state.ms)} ${state.label}`).join(', ')}.`}
                >
                  {block.segments
                    .filter((segment) => segment.state !== 'focused')
                    .map((segment) => (
                      <span
                        key={`band:${segment.startMs}`}
                        className={cn('tempo-cal-band', `is-${segment.state}`)}
                        style={{
                          top: `${((segment.startMs - block.startMs) / span) * 100}%`,
                          height: `${((segment.endMs - segment.startMs) / span) * 100}%`
                        }}
                        aria-hidden="true"
                      />
                    ))}
                  {block.segments.map((segment) => (
                    <span
                      key={`stripe:${segment.startMs}`}
                      className={cn('tempo-cal-stripe', `is-${segment.state}`)}
                      style={{
                        top: `${((segment.startMs - block.startMs) / span) * 100}%`,
                        height: `${((segment.endMs - segment.startMs) / span) * 100}%`
                      }}
                      aria-hidden="true"
                    />
                  ))}
                  {height >= 16 && (
                    <span className="tempo-cal-block-body">
                      {height >= 46 && (
                        <span className="tempo-cal-block-kind">
                          <span>{kindLabel}</span>
                          <span>
                            {timeLabel(block.startMs)}–{timeLabel(block.endMs)}
                          </span>
                        </span>
                      )}
                      <span className="tempo-cal-block-title">
                        <span>{block.title}</span>
                        <span className="tempo-cal-block-total">{formatDuration(total)}</span>
                      </span>
                      {height >= 64 && mix.length > 0 && (
                        <span className="tempo-cal-mix">
                          {mix.map((state) => (
                            <span key={state.key}>
                              <span
                                className={cn('tempo-day-dot', `is-${state.key}`)}
                                aria-hidden="true"
                              />
                              {formatDuration(state.ms)} {state.label}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </PopoverAnchor>
              <PopoverContent
                side="right"
                align="start"
                collisionPadding={12}
                className="tempo-cal-popover w-80 p-0"
              >
                <BlockDetails
                  block={block}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={onSelectSession}
                />
              </PopoverContent>
            </Popover>
          )
        })}
        {showCalendar && (
          <div className="tempo-cal-lane" aria-label="Calendar events">
            {visibleEvents.map(({ event, lane }) => {
              const top = y(Math.max(event.startMs, startMs))
              const height = Math.max(12, y(Math.min(event.endMs, endMs)) - top - 2)
              return (
                <div
                  key={event.id}
                  className="tempo-cal-event"
                  style={
                    {
                      top,
                      height,
                      left: `${(lane / eventLanes) * 100}%`,
                      width: `calc(${100 / eventLanes}% - 2px)`,
                      '--calendar-color': calendarColor(event.calendarId)
                    } as CSSProperties
                  }
                  title={`${event.title}, ${timeLabel(event.startMs)}–${timeLabel(event.endMs)}${event.location ? `, ${event.location}` : ''}`}
                >
                  <span>{event.title}</span>
                  {height >= 30 && (
                    <time>
                      {timeLabel(event.startMs)}–{timeLabel(event.endMs)}
                    </time>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {nowMs !== null && nowMs >= startMs && nowMs <= endMs && (
          <div className="tempo-cal-now" style={{ top: y(nowMs) }} aria-hidden="true" />
        )}
      </div>
    </div>
  )
}
