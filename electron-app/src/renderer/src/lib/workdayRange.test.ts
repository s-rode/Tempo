import { describe, expect, test } from 'bun:test'
import { getWorkdayRange } from './workdayRange'

describe('getWorkdayRange', () => {
  test('keeps the prior workday until 06:00 and starts a fresh one at 06:00', () => {
    const beforeBoundary = new Date(2026, 8, 16, 5, 59, 59).getTime()
    const atBoundary = new Date(2026, 8, 16, 6, 0, 0).getTime()

    const previous = getWorkdayRange(beforeBoundary)
    const current = getWorkdayRange(atBoundary)

    expect(previous.startDateMs).toBe(new Date(2026, 8, 15, 6, 0, 0).getTime())
    expect(previous.endDateMs).toBe(atBoundary)
    expect(current.startDateMs).toBe(atBoundary)
    expect(current.endDateMs).toBe(new Date(2026, 8, 17, 6, 0, 0).getTime())
  })

  test('honours a manual reset without changing the next calendar boundary', () => {
    const resetAtMs = new Date(2026, 8, 16, 9, 45, 0).getTime()
    const range = getWorkdayRange(new Date(2026, 8, 16, 11, 0, 0).getTime(), resetAtMs)

    expect(range.startDateMs).toBe(resetAtMs)
    expect(range.endDateMs).toBe(new Date(2026, 8, 17, 6, 0, 0).getTime())
  })
})
