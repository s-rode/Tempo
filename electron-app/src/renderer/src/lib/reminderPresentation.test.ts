import { describe, expect, test } from 'bun:test'
import { DEFAULT_REMINDER_FILTER } from 'shared/reminders'
import { reminderDatePresentation, reminderFilterSummary } from './reminderPresentation'

describe('reminder list presentation', () => {
  const now = new Date(2026, 9, 20, 12)
  test('places undated items last without inventing a due date', () => {
    expect(reminderDatePresentation(null, now)).toEqual({
      group: 'unscheduled',
      label: '',
      fullLabel: 'No due date'
    })
  })
  test('labels calendar-day deadlines and distinguishes overdue from today', () => {
    expect(reminderDatePresentation({ year: 2026, month: 10, day: 19 }, now)).toMatchObject({
      group: 'overdue',
      label: 'Yesterday'
    })
    expect(reminderDatePresentation({ year: 2026, month: 10, day: 20, hour: 8 }, now).group).toBe(
      'today'
    )
    expect(reminderDatePresentation({ year: 2026, month: 10, day: 21 }, now).group).toBe('upcoming')
  })
  test('uses the local calendar day of an explicit timed deadline', () => {
    const instant = new Date(2026, 9, 20, 1).getTime()
    expect(
      reminderDatePresentation(
        { year: 2026, month: 10, day: 19, hour: 23, timestampMs: instant },
        now
      ).group
    ).toBe('today')
  })
  test('yesterday crosses daylight-saving and month boundaries as a calendar day', () => {
    expect(
      reminderDatePresentation({ year: 2026, month: 10, day: 31 }, new Date(2026, 10, 1, 12)).label
    ).toBe('Yesterday')
    expect(
      reminderDatePresentation({ year: 2026, month: 10, day: 25 }, new Date(2026, 9, 26, 12)).label
    ).toBe('Yesterday')
  })
  test('summaries retain OR versus AND and resolve list names', () => {
    const lists = [{ id: 'uni', name: 'Uni', accountName: 'iCloud' }]
    expect(reminderFilterSummary(DEFAULT_REMINDER_FILTER, lists)).toBe('Due today or Overdue')
    expect(
      reminderFilterSummary(
        { match: 'all', rules: [{ kind: 'list', listIds: ['uni'] }, { kind: 'due_today' }] },
        lists
      )
    ).toBe('Uni and Due today')
    expect(
      reminderFilterSummary(
        { match: 'any', rules: [{ kind: 'list', listIds: ['missing'] }] },
        lists
      )
    ).toBe('Unavailable list')
    expect(reminderFilterSummary({ match: 'any', rules: [] }, lists)).toBe(
      'All unfinished reminders'
    )
  })
})
