import type { CalendarEvent } from 'shared/calendar'
import type { ActivitySessionBlock } from './activitySessions'

/** Real timestamps preserve DST and clip overnight events to the selected date. */
export function calendarComparisonRange(
  date: Date,
  events: CalendarEvent[],
  sessions: ActivitySessionBlock[]
) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  const intervals = [
    ...events
      .filter((event) => !event.allDay)
      .map((event) => ({ start: event.startMs, end: event.endMs })),
    ...sessions.map((session) => ({ start: +session.startTime, end: +session.endTime }))
  ].filter((interval) => interval.end > dayStart && interval.start < dayEnd)
  const defaultStart = +new Date(date.getFullYear(), date.getMonth(), date.getDate(), 8)
  const defaultEnd = +new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18)
  const first = Math.min(
    defaultStart,
    ...intervals.map((interval) => Math.max(dayStart, interval.start))
  )
  const last = Math.max(defaultEnd, ...intervals.map((interval) => Math.min(dayEnd, interval.end)))
  const start = Math.max(
    dayStart,
    dayStart + Math.floor((first - dayStart) / 3_600_000) * 3_600_000
  )
  const end = Math.min(dayEnd, dayStart + Math.ceil((last - dayStart) / 3_600_000) * 3_600_000)
  return { start, end }
}

export function packCalendarEvents(events: CalendarEvent[]) {
  const ends: number[] = []
  return [...events]
    .filter((event) => !event.allDay && event.endMs > event.startMs)
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs)
    .map((event) => {
      let lane = ends.findIndex((end) => end <= event.startMs)
      if (lane === -1) lane = ends.length
      ends[lane] = event.endMs
      return { event, lane }
    })
}
