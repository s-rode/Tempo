import { describe, expect, test } from 'bun:test'
import { calendarSchedule } from '../src/main/calendarSchedule'
import type { CalendarEvent, CalendarPreferences } from '../../shared/calendar'
const minute = 60_000
const start = new Date('2026-10-28T10:00:00Z').getTime()
const prefs: CalendarPreferences = {
  enabled: true,
  selectedCalendarIds: null,
  askToPause: true,
  leadMinutes: 0
}
const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event',
  calendarId: 'work',
  title: 'Lecture',
  startMs: start,
  endMs: start + 60 * minute,
  allDay: false,
  ...overrides
})

describe('calendar pause schedule', () => {
  test('zero prompts exactly at the event start without pausing automatically', () => {
    expect(calendarSchedule(prefs, [event()], {}, start - 1).notice).toBeNull()
    const plan = calendarSchedule(prefs, [event()], {}, start)
    expect(plan.notice?.id).toBe('event')
    expect(plan.pauseUntilMs).toBeNull()
    expect(plan.nextAtMs).toBe(start + 60 * minute)
  })
  test('a ten-minute lead prompts early, but accepting pauses only at the start', () => {
    const settings = { ...prefs, leadMinutes: 10 }
    expect(calendarSchedule(settings, [event()], {}, start - 11 * minute).nextAtMs).toBe(
      start - 10 * minute
    )
    expect(calendarSchedule(settings, [event()], {}, start - 10 * minute).notice?.id).toBe('event')
    const accepted = { event: { action: 'pause' as const, endMs: start + 60 * minute } }
    const early = calendarSchedule(settings, [event()], accepted, start - 5 * minute)
    expect(early.pauseUntilMs).toBeNull()
    expect(early.nextAtMs).toBe(start)
    expect(calendarSchedule(settings, [event()], accepted, start).pauseUntilMs).toBe(
      start + 60 * minute
    )
    expect(
      calendarSchedule(settings, [event()], accepted, start + 60 * minute).pauseUntilMs
    ).toBeNull()
  })
  test('keeping tracking suppresses this occurrence and never affects the next recurrence', () => {
    const next = event({
      id: 'tomorrow',
      startMs: start + 24 * 60 * minute,
      endMs: start + 25 * 60 * minute
    })
    const decisions = { event: { action: 'keep' as const, endMs: start + 60 * minute } }
    expect(calendarSchedule(prefs, [event(), next], decisions, start).notice).toBeNull()
    expect(calendarSchedule(prefs, [event(), next], decisions, next.startMs).notice?.id).toBe(
      'tomorrow'
    )
  })
  test('accepted overlapping events retain the pause until every accepted event has ended', () => {
    const second = event({ id: 'second', startMs: start + 30 * minute, endMs: start + 90 * minute })
    const decisions = {
      event: { action: 'pause' as const, endMs: start + 60 * minute },
      second: { action: 'pause' as const, endMs: second.endMs }
    }
    expect(
      calendarSchedule(prefs, [event(), second], decisions, start + 45 * minute).pauseUntilMs
    ).toBe(second.endMs)
    expect(
      calendarSchedule(prefs, [event(), second], decisions, start + 60 * minute).pauseEventIds
    ).toEqual(['second'])
    expect(
      calendarSchedule(prefs, [event(), second], decisions, second.endMs).pauseUntilMs
    ).toBeNull()
  })
  test('event edits update the accepted end time and deletions remove its lease', () => {
    const decisions = { event: { action: 'pause' as const, endMs: start + 60 * minute } }
    const edited = event({ endMs: start + 15 * minute })
    expect(calendarSchedule(prefs, [edited], decisions, start).pauseUntilMs).toBe(edited.endMs)
    expect(calendarSchedule(prefs, [], decisions, start).pauseUntilMs).toBeNull()
    const moved = event({ startMs: start + 60 * minute, endMs: start + 120 * minute })
    expect(calendarSchedule(prefs, [moved], decisions, start).pauseUntilMs).toBeNull()
    expect(calendarSchedule(prefs, [moved], decisions, start).nextAtMs).toBe(moved.startMs)
  })
  test('all-day events and unselected calendars never prompt or pause', () => {
    expect(calendarSchedule(prefs, [event({ allDay: true })], {}, start).notice).toBeNull()
    const decisions = { event: { action: 'pause' as const, endMs: start + 60 * minute } }
    expect(
      calendarSchedule({ ...prefs, selectedCalendarIds: [] }, [event()], decisions, start)
        .pauseUntilMs
    ).toBeNull()
  })
  test('restart and wake reconcile accepted pauses and never prompt for ended events', () => {
    const decisions = { event: { action: 'pause' as const, endMs: start + 60 * minute } }
    expect(
      calendarSchedule(prefs, [event()], JSON.parse(JSON.stringify(decisions)), start + 5 * minute)
        .pauseUntilMs
    ).toBe(start + 60 * minute)
    expect(calendarSchedule(prefs, [event()], {}, start + 61 * minute).notice).toBeNull()
    expect(calendarSchedule(prefs, [event()], {}, start + 5 * minute).notice?.id).toBe('event')
  })
  test('a failed refresh suppresses new prompts while retaining an already accepted end boundary', () => {
    expect(calendarSchedule(prefs, [event()], {}, start, false).notice).toBeNull()
    expect(
      calendarSchedule(
        prefs,
        [event()],
        { event: { action: 'pause', endMs: start + 60 * minute } },
        start,
        false
      ).pauseUntilMs
    ).toBe(start + 60 * minute)
  })
  test('turning prompts off preserves explicit choices; disconnecting ends calendar-owned pauses', () => {
    const decisions = { event: { action: 'pause' as const, endMs: start + 60 * minute } }
    expect(
      calendarSchedule({ ...prefs, askToPause: false }, [event()], decisions, start).pauseUntilMs
    ).toBe(start + 60 * minute)
    expect(
      calendarSchedule({ ...prefs, enabled: false }, [event()], decisions, start).pauseUntilMs
    ).toBeNull()
  })
})
