import type {
  CalendarEvent,
  CalendarPauseNotice,
  CalendarPreferences
} from '../../../shared/calendar'

export interface CalendarDecision {
  action: 'pause' | 'keep' | 'pending'
  endMs: number
}
export type CalendarDecisions = Record<string, CalendarDecision>

/** Pure, clock-injected schedule. Calendar time never becomes tracked time. */
export function calendarSchedule(
  preferences: CalendarPreferences,
  events: CalendarEvent[],
  decisions: CalendarDecisions,
  now: number,
  allowPrompts = true
): {
  notice: CalendarPauseNotice | null
  pauseUntilMs: number | null
  pauseEventIds: string[]
  nextAtMs: number | null
} {
  if (!preferences.enabled)
    return { notice: null, pauseUntilMs: null, pauseEventIds: [], nextAtMs: null }
  const selected = events
    .filter(
      (event) =>
        !event.allDay &&
        event.endMs > now &&
        event.endMs > event.startMs &&
        (preferences.selectedCalendarIds === null ||
          preferences.selectedCalendarIds.includes(event.calendarId))
    )
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  const activePauses = selected.filter(
    (event) => decisions[event.id]?.action === 'pause' && event.startMs <= now
  )
  const pending =
    allowPrompts && preferences.askToPause
      ? selected.find(
          (event) =>
            (!decisions[event.id] || decisions[event.id].action === 'pending') &&
            event.startMs - preferences.leadMinutes * 60_000 <= now
        )
      : undefined
  const deadlines = selected
    .flatMap((event) => {
      const decision = decisions[event.id]
      if (decision?.action === 'pause') return [event.startMs, event.endMs]
      if ((!decision || decision.action === 'pending') && preferences.askToPause && allowPrompts)
        return [event.startMs - preferences.leadMinutes * 60_000, event.endMs]
      return []
    })
    .filter((time) => time > now)
  return {
    notice: pending
      ? {
          id: pending.id,
          title: pending.title,
          calendarName: '',
          startMs: pending.startMs,
          endMs: pending.endMs
        }
      : null,
    pauseUntilMs: activePauses.length
      ? Math.max(...activePauses.map((event) => event.endMs))
      : null,
    pauseEventIds: activePauses.map((event) => event.id),
    nextAtMs: deadlines.length ? Math.min(...deadlines) : null
  }
}
