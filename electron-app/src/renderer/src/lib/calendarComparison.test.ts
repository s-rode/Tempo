import { expect, test } from 'bun:test'
import type { CalendarEvent } from 'shared/calendar'
import { calendarComparisonRange, packCalendarEvents } from './calendarComparison'
const day = new Date(2026, 9, 28)
const at = (hour: number) => +new Date(2026, 9, 28, hour)
const event = (id: string, start: number, end: number): CalendarEvent => ({
  id,
  title: id,
  calendarId: 'calendar',
  startMs: at(start),
  endMs: at(end),
  allDay: false
})
test('overlapping events occupy distinct lanes while touching events reuse a lane', () => {
  const packed = packCalendarEvents([
    event('third', 11, 12),
    event('first', 9, 10),
    event('second', 9, 11)
  ])
  expect(packed.find((item) => item.event.id === 'first')?.lane).not.toBe(
    packed.find((item) => item.event.id === 'second')?.lane
  )
  expect(packed.find((item) => item.event.id === 'third')?.lane).toBe(0)
})
test('overnight events clip to the real local day; all-day events do not stretch the ruler', () => {
  const range = calendarComparisonRange(
    day,
    [event('overnight', -2, 1), { ...event('all day', -12, 36), allDay: true }],
    []
  )
  expect(range.start).toBe(+day)
  expect(range.end).toBe(at(18))
})
test('calendar and recorded intervals share a range that includes late work', () => {
  const range = calendarComparisonRange(day, [event('meeting', 9, 10)], [
    { startTime: new Date(at(20)), endTime: new Date(at(22)) }
  ] as any)
  expect(range).toEqual({ start: at(8), end: at(22) })
})
