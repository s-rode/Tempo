import { describe, expect, test } from 'bun:test'
import {
  dropIndex,
  formatClock,
  moveTaskInWeek,
  parseQuickTask,
  relativeDayLabel,
  weekRangeLabel,
  weekStartOf,
  type PlannerTask,
  type PlannerWeek
} from './plannerModel'

const goals = [
  { id: 'g-thesis', title: 'Finish my thesis', completedAtMs: null },
  { id: 'g-fit', title: 'Run a half marathon', completedAtMs: null },
  { id: 'g-french', title: 'French B2', completedAtMs: null },
  { id: 'g-old', title: 'Freelance site', completedAtMs: 5 }
]
const task = (id: string, position: number): PlannerTask => ({
  id,
  text: id,
  position,
  completedAtMs: null
})
const week = (): PlannerWeek => ({
  weekStartKey: '2026-11-16',
  todayKey: '2026-11-18',
  days: [
    { dateKey: '2026-11-18', open: [task('a', 0), task('b', 1), task('c', 2)], done: [] },
    { dateKey: '2026-11-19', open: [task('x', 0)], done: [] }
  ]
})
const order = (value: PlannerWeek, dateKey: string) =>
  value.days.find((day) => day.dateKey === dateKey)!.open.map((entry) => entry.id)

describe('planner quick entry', () => {
  test('a trailing tag links the goal and keeps the estimate', () => {
    expect(parseQuickTask('Draft chapter 3 #thesis 45m', goals)).toEqual({
      text: 'Draft chapter 3',
      goalId: 'g-thesis',
      estimatedMinutes: 45
    })
    expect(parseQuickTask('Draft chapter 3 1h 30m #finish', goals)).toEqual({
      text: 'Draft chapter 3',
      goalId: 'g-thesis',
      estimatedMinutes: 90
    })
  })

  test('a leading tag works too', () => {
    expect(parseQuickTask('#run Long run 12 km', goals)).toEqual({
      text: 'Long run 12 km',
      goalId: 'g-fit',
      estimatedMinutes: null
    })
  })

  test('ambiguous, unknown and achieved goals leave the text alone', () => {
    expect(parseQuickTask('Fix issue #f', goals).goalId).toBeNull()
    expect(parseQuickTask('Fix issue #f', goals).text).toBe('Fix issue #f')
    expect(parseQuickTask('Reply about #1234', goals).text).toBe('Reply about #1234')
    expect(parseQuickTask('Invoice #freelance', goals).goalId).toBeNull()
  })

  test('a plain title stays untouched', () => {
    expect(parseQuickTask('  Call the landlord  ', goals)).toEqual({
      text: 'Call the landlord',
      goalId: null,
      estimatedMinutes: null
    })
  })
})

describe('planner week model', () => {
  test('reordering inside a day', () => {
    expect(order(moveTaskInWeek(week(), 'c', '2026-11-18', '2026-11-18', 0), '2026-11-18')).toEqual(
      ['c', 'a', 'b']
    )
  })

  test('moving to another day removes it from the first', () => {
    const moved = moveTaskInWeek(week(), 'a', '2026-11-18', '2026-11-19', 1)
    expect(order(moved, '2026-11-18')).toEqual(['b', 'c'])
    expect(order(moved, '2026-11-19')).toEqual(['x', 'a'])
    expect(moved.days[0].open.map((entry) => entry.position)).toEqual([0, 1])
  })

  test('an unknown task changes nothing', () => {
    const before = week()
    expect(moveTaskInWeek(before, 'zzz', '2026-11-18', '2026-11-19', 0)).toBe(before)
  })

  test('drop index ignores the dragged task itself', () => {
    const day = week().days[0]
    expect(dropIndex(day, 'a', 'c')).toBe(1)
    expect(dropIndex(day, 'c', 'a')).toBe(0)
    expect(dropIndex(day, 'a', null)).toBe(2)
    expect(dropIndex(day, 'x', null)).toBe(3)
  })

  test('labels', () => {
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16')
    expect(weekRangeLabel('2026-11-16', 'en-US')).toBe('Nov 16–22, 2026')
    expect(weekRangeLabel('2026-11-30', 'en-US')).toBe('Nov 30 – Dec 6, 2026')
    expect(relativeDayLabel('2026-11-19', '2026-11-18', 'en-US')).toBe('Tomorrow')
    expect(relativeDayLabel('2026-11-21', '2026-11-18', 'en-US')).toBe('Saturday')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })
})
