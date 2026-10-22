import { expect, test } from 'bun:test'
import { buildWeekColumns, weekDurationLabel } from './weekColumns'

test('weekly reporting retains Sunday-based days and local calendar boundaries', () => {
  const date = new Date(2026, 9, 22, 12)
  const event = {
    startTime: new Date(2026, 9, 18, 10),
    durationMs: 60000,
    categoryId: 'work',
    isProductive: true
  }
  const week = buildWeekColumns([event] as any, date)
  expect(week[0].date.getDay()).toBe(0)
  expect(week[0].date.getDate()).toBe(18)
  expect(week[0].focusedMs).toBe(60000)
  expect(week[6].date.getDate()).toBe(24)
})

test('weekly labels retain subminute suppression and hours plus minutes', () => {
  expect(weekDurationLabel(59000)).toBeNull()
  expect(weekDurationLabel(60000)).toBe('1m')
  expect(weekDurationLabel(3660000)).toBe('1h 1m')
})
