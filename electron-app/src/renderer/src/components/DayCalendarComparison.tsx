import { CalendarDays, Pause, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CalendarEvent } from 'shared/calendar'
import { useAppleCalendar } from '../hooks/useAppleCalendar'
import type { ActivitySessionBlock } from '../lib/activitySessions'
import { calendarComparisonRange, packCalendarEvents } from '../lib/calendarComparison'
import { calendarPeriod } from '../lib/calendarPeriod'
import { formatDuration } from '../lib/activityByCategoryWidgetHelpers'
import { Button } from './ui/button'

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const rangeLabel = (event: CalendarEvent) =>
  event.allDay ? 'All day' : `${time(event.startMs)}–${time(event.endMs)}`

export function DayCalendarComparison({
  date,
  sessions,
  onSelectSession
}: {
  date: Date
  sessions: ActivitySessionBlock[]
  onSelectSession: (session: ActivitySessionBlock) => void
}) {
  const day = calendarPeriod(date, 'day')
  const {
    status,
    error: loadError,
    reload
  } = useAppleCalendar({ startMs: day.startDateMs, endMs: day.endDateMs })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const events = useMemo(
    () =>
      (status?.events || [])
        .filter(
          (event) =>
            event.startMs < day.endDateMs &&
            event.endMs > day.startDateMs &&
            (status?.preferences.selectedCalendarIds === null ||
              status?.preferences.selectedCalendarIds.includes(event.calendarId))
        )
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs),
    [status, day.startDateMs, day.endDateMs]
  )
  const selected = events.find((event) => event.id === selectedId)
  const calendarFor = (event: CalendarEvent) =>
    status?.calendars.find((calendar) => calendar.id === event.calendarId)
  const packed = packCalendarEvents(events)
  const lanes = Math.max(1, ...packed.map((item) => item.lane + 1))
  const range = calendarComparisonRange(date, events, sessions)
  const position = (start: number, end: number) => ({
    left: `${Math.max(0, (Math.max(start, range.start) - range.start) / (range.end - range.start)) * 100}%`,
    width: `${Math.max(0, (Math.min(end, range.end) - Math.max(start, range.start)) / (range.end - range.start)) * 100}%`
  })
  const ticks: number[] = []
  for (let point = range.start; point <= range.end; point += 2 * 3_600_000) ticks.push(point)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      await work()
      await reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Calendar is unavailable.')
    } finally {
      setBusy(false)
    }
  }
  if (!status) return null
  if (!status.preferences.enabled)
    return (
      <div className="tempo-calendar-connect">
        <CalendarDays size={15} aria-hidden="true" />
        <span>Compare your calendar with tracked activity.</span>
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => void run(() => window.api.connectAppleCalendar())}
        >
          Connect Calendar
        </Button>
        {actionError && <p role="status">{actionError}</p>}
      </div>
    )
  return (
    <section
      className="tempo-calendar-comparison"
      aria-label="Calendar and tracked activity comparison"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Calendar & tracked</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            aria-label="Refresh calendar events"
            onClick={() => void run(() => window.api.refreshAppleCalendar())}
          >
            <RefreshCw size={12} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void window.api.openAppleCalendar()}>
            Open Calendar
          </Button>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Your schedule above, recorded activity below. Calendar time is never counted as tracked
        time.
      </p>
      {(status.error || loadError || actionError) && (
        <p role="status" className="mb-2 text-xs text-destructive">
          {actionError ||
            loadError ||
            (status.error === 'permission_denied'
              ? 'Calendar access was removed. Reconnect in Settings.'
              : 'Calendar could not refresh. Events may be out of date.')}
        </p>
      )}
      {events.some((event) => event.allDay) && (
        <div className="tempo-calendar-all-day">
          <span>All day</span>
          {events
            .filter((event) => event.allDay)
            .map((event) => (
              <button
                type="button"
                key={event.id}
                onClick={() => setSelectedId(event.id)}
                aria-pressed={selectedId === event.id}
              >
                <span
                  className="tempo-calendar-color"
                  style={{ background: calendarFor(event)?.color }}
                  aria-hidden="true"
                />
                {event.title}
              </button>
            ))}
        </div>
      )}
      <div className="tempo-calendar-ruler">
        <span />
        <div>
          {ticks.map((point) => (
            <time
              key={point}
              dateTime={new Date(point).toISOString()}
              style={{ left: `${((point - range.start) / (range.end - range.start)) * 100}%` }}
            >
              {time(point)}
            </time>
          ))}
        </div>
      </div>
      <div className="tempo-calendar-lane">
        <span className="tempo-calendar-lane-label">Calendar</span>
        <div
          className="tempo-calendar-lane-body"
          style={{ height: lanes * 27 }}
          aria-label="Scheduled calendar events"
        >
          {packed.map(({ event, lane }) => (
            <button
              key={event.id}
              type="button"
              className="tempo-calendar-event-bar"
              style={
                {
                  ...position(event.startMs, event.endMs),
                  top: lane * 27,
                  borderColor: calendarFor(event)?.color,
                  '--calendar-event-color': calendarFor(event)?.color
                } as React.CSSProperties
              }
              onClick={() => setSelectedId(selectedId === event.id ? null : event.id)}
              aria-pressed={selectedId === event.id}
              title={`${event.title} · ${rangeLabel(event)} · ${calendarFor(event)?.title || 'Calendar'}`}
              aria-label={`${event.title}, scheduled ${rangeLabel(event)}, ${calendarFor(event)?.title || 'Calendar'}. Show event details.`}
            >
              {event.title}
            </button>
          ))}
          {!packed.length && <span className="tempo-calendar-no-events">No timed events</span>}
        </div>
      </div>
      <div className="tempo-calendar-lane">
        <span className="tempo-calendar-lane-label">Tracked</span>
        <div
          className="tempo-calendar-lane-body tempo-calendar-tracked"
          aria-label="Recorded activity on the same time scale"
        >
          {sessions
            .filter((session) => +session.endTime > range.start && +session.startTime < range.end)
            .map((session) => (
              <button
                key={session.id}
                type="button"
                className={`tempo-calendar-recording ${session.isProductive === true ? 'is-focused' : session.isProductive === false ? 'is-distracted' : 'is-uncertain'}`}
                style={position(+session.startTime, +session.endTime)}
                onClick={() => onSelectSession(session)}
                title={`${session.label} · ${time(+session.startTime)}–${time(+session.endTime)} · ${formatDuration(session.activeDurationMs)} tracked`}
                aria-label={`${session.label}, ${time(+session.startTime)} to ${time(+session.endTime)}, ${formatDuration(session.activeDurationMs)} tracked. Select activity.`}
              />
            ))}
          {!sessions.length && (
            <span className="tempo-calendar-no-events">No tracked activity</span>
          )}
        </div>
      </div>
      <div className="tempo-calendar-agenda" aria-label="Calendar event list">
        {(showAll ? events : events.slice(0, 3)).map((event) => (
          <button
            key={event.id}
            type="button"
            className="tempo-calendar-agenda-row"
            onClick={() => setSelectedId(selectedId === event.id ? null : event.id)}
            aria-pressed={selectedId === event.id}
          >
            <time>{rangeLabel(event)}</time>
            <span
              className="tempo-calendar-color"
              style={{ background: calendarFor(event)?.color }}
              aria-hidden="true"
            />
            <span className="tempo-calendar-agenda-title">{event.title}</span>
            {status.scheduledPauseIds.includes(event.id) && (
              <Pause size={11} aria-label="Tracking pause scheduled" />
            )}
          </button>
        ))}
        {events.length > 3 && (
          <button
            type="button"
            className="tempo-calendar-show-more"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show fewer events' : `Show ${events.length - 3} more events`}
          </button>
        )}
        {!events.length && (
          <p className="text-xs text-muted-foreground">
            No events in the selected calendars for this day.
          </p>
        )}
      </div>
      {selected && (
        <section
          className="tempo-calendar-event-detail"
          aria-label={`${selected.title} calendar event details`}
        >
          <p className="text-xs font-medium">{selected.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {rangeLabel(selected)} · {calendarFor(selected)?.title}
            {selected.location ? ` · ${selected.location}` : ''}
          </p>
          {!selected.allDay && selected.endMs > Date.now() && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant={status.scheduledPauseIds.includes(selected.id) ? 'outline' : 'secondary'}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.api.respondToCalendarEvent(
                      selected.id,
                      status.scheduledPauseIds.includes(selected.id) ? 'keep' : 'pause'
                    )
                  )
                }
              >
                {status.scheduledPauseIds.includes(selected.id)
                  ? 'Keep tracking for this event'
                  : 'Pause tracking during event'}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {status.scheduledPauseIds.includes(selected.id)
                  ? 'Pause scheduled · resumes at event end'
                  : 'Pauses at the start, resumes at the end'}
              </span>
            </div>
          )}
          {selected.allDay && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              All-day events do not trigger tracking prompts.
            </p>
          )}
        </section>
      )}
    </section>
  )
}
