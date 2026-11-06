import { expect, test } from 'bun:test'
import type { ActivitySessionBlock } from './activitySessions'
import { buildDayOverview } from './dayOverview'

const day = new Date(2026, 9, 28)
const at = (hour: number, minute = 0) => new Date(2026, 9, 28, hour, minute)

const session = (
  id: string,
  start: Date,
  end: Date,
  isProductive?: boolean
): ActivitySessionBlock => ({
  id,
  displayKey: id,
  startTime: start,
  endTime: end,
  activeDurationMs: +end - +start,
  categoryId: 'category',
  isProductive,
  ownerName: 'App',
  label: id,
  eventIds: [],
  briefActivities: [],
  sourceBlocks: []
})

test('an empty day has no overview', () => {
  expect(buildDayOverview(day, [])).toBeNull()
})

test('rows span first to last activity hour and split sessions at hour boundaries', () => {
  const overview = buildDayOverview(day, [
    session('work', at(9, 30), at(10, 15), true),
    session('video', at(10, 30), at(10, 45), false),
    session('unknown', at(11, 50), at(11, 55))
  ])!
  expect(overview.startMs).toBe(+at(9))
  expect(overview.endMs).toBe(+at(12))
  expect(overview.rows.map((row) => row.hourStartMs)).toEqual([+at(9), +at(10), +at(11)])

  const [nine, ten, eleven] = overview.rows
  expect(nine.segments).toHaveLength(1)
  expect(nine.segments[0].offset).toBe(0.5)
  expect(nine.segments[0].width).toBe(0.5)
  expect(ten.segments.map((segment) => segment.state)).toEqual(['focused', 'distracted'])
  expect(ten.focusedMs).toBe(15 * 60_000)
  expect(ten.distractedMs).toBe(15 * 60_000)
  expect(ten.idleMs).toBe(30 * 60_000)
  expect(eleven.uncertainMs).toBe(5 * 60_000)

  // Tracked and idle time add up to the elapsed range.
  expect(overview.focusedMs + overview.distractedMs + overview.uncertainMs + overview.idleMs).toBe(
    overview.endMs - overview.startMs
  )
})

test('overlapping sessions are counted once and overnight sessions clip to the day', () => {
  const overview = buildDayOverview(day, [
    session('late', at(23, 30), new Date(2026, 9, 29, 1), true),
    session('overlap', at(23, 40), at(23, 50), false)
  ])!
  expect(overview.endMs).toBe(+new Date(2026, 9, 29))
  expect(overview.rows).toHaveLength(1)
  expect(overview.rows[0].focusedMs).toBe(30 * 60_000)
  expect(overview.rows[0].distractedMs).toBe(0)
  expect(overview.rows[0].idleMs).toBe(30 * 60_000)
})
