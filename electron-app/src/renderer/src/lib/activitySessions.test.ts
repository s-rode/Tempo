import { describe, expect, test } from 'bun:test'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { buildActivitySessions, buildDayActivitySummaries, sessionTotals } from './activitySessions'

const base = new Date('2026-09-02T10:00:00.000Z').getTime()

const block = (overrides: Partial<ProcessedEventBlock> = {}): ProcessedEventBlock => {
  const start = overrides.startTime || new Date(base)
  const durationMs = overrides.durationMs ?? 60_000
  return {
    startTime: start,
    endTime: overrides.endTime || new Date(start.getTime() + durationMs),
    durationMs,
    name: 'Gaussian Process tutorial',
    ownerName: 'Firefox',
    title: 'Gaussian Process tutorial',
    activityKey: 'firefox:example',
    activityLabel: 'Gaussian Process tutorial',
    categoryId: 'work',
    categoryName: 'Work',
    categoryColor: '#00aa00',
    isProductive: true,
    eventIds: [String(start.getTime())],
    originalEvent: {
      eventId: String(start.getTime()),
      timestamp: start.getTime(),
      ownerName: 'Firefox',
      title: 'Gaussian Process tutorial',
      type: 'browser',
      browser: 'firefox',
      categoryId: 'work'
    } as ProcessedEventBlock['originalEvent'],
    ...overrides
  }
}

describe('activity sessions', () => {
  test('merges consecutive Firefox OCR fingerprints with the same page title', () => {
    const first = block({ activityKey: 'firefox:first' })
    const second = block({
      activityKey: 'firefox:second',
      startTime: new Date(base + 60_000),
      endTime: new Date(base + 120_000)
    })
    const sessions = buildActivitySessions([first, second])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].eventIds).toHaveLength(2)
    expect(sessions[0].activeDurationMs).toBe(120_000)
  })

  test('merges continuous application activity when only the window title changes', () => {
    const first = block({
      ownerName: 'RemNote',
      title: 'Graphical Models flashcards',
      activityLabel: 'Graphical Models flashcards',
      activityKey: 'app:remnote:first',
      originalEvent: { ...block().originalEvent, ownerName: 'RemNote', title: 'Graphical Models flashcards', type: 'window', browser: null }
    })
    const second = block({
      ownerName: 'RemNote',
      title: 'Kernel Methods flashcards',
      activityLabel: 'Kernel Methods flashcards',
      activityKey: 'app:remnote:second',
      startTime: new Date(base + 60_000),
      endTime: new Date(base + 120_000),
      originalEvent: { ...first.originalEvent, title: 'Kernel Methods flashcards' }
    })
    const sessions = buildActivitySessions([first, second])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activeDurationMs).toBe(120_000)
  })

  test('keeps return visits separate after a meaningful activity switch', () => {
    const first = block()
    const interruption = block({
      ownerName: 'Signal',
      title: 'Signal',
      activityLabel: 'Signal',
      activityKey: 'app:signal',
      categoryId: 'distraction',
      categoryName: 'Distraction',
      isProductive: false,
      startTime: new Date(base + 60_000),
      endTime: new Date(base + 120_000),
      originalEvent: { ...first.originalEvent, ownerName: 'Signal', title: 'Signal', type: 'window', browser: null, categoryId: 'distraction' }
    })
    const returnVisit = block({
      startTime: new Date(base + 120_000),
      endTime: new Date(base + 180_000)
    })
    const sessions = buildActivitySessions([first, interruption, returnVisit])
    expect(sessions).toHaveLength(3)
    expect(sessions[0].displayKey).toBe(sessions[2].displayKey)
  })

  test('removes a historical generic Firefox activation duplicate', () => {
    const page = block()
    const generic = block({
      activityKey: 'app:firefox',
      startTime: new Date(base + 2_000),
      endTime: new Date(base + 62_000),
      originalEvent: { ...page.originalEvent, browser: null, type: 'window' }
    })
    const sessions = buildActivitySessions([page, generic])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].eventIds).toEqual(page.eventIds)
  })

  test('folds a brief productive transition without changing totals', () => {
    const first = block({ durationMs: 120_000, endTime: new Date(base + 120_000) })
    const brief = block({
      ownerName: 'Notes',
      title: 'Notes',
      activityKey: 'app:notes',
      activityLabel: 'Notes',
      durationMs: 20_000,
      startTime: new Date(base + 120_000),
      endTime: new Date(base + 140_000),
      originalEvent: { ...first.originalEvent, ownerName: 'Notes', title: 'Notes', type: 'window', browser: null }
    })
    const sessions = buildActivitySessions([first, brief])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].briefActivities).toHaveLength(1)
    expect(sessionTotals(sessions).focusedMs).toBe(140_000)
  })

  test('aggregates repeat visits into one summary row while preserving sessions', () => {
    const first = block()
    const second = block({ startTime: new Date(base + 5 * 60_000), endTime: new Date(base + 6 * 60_000) })
    const summaries = buildDayActivitySummaries(buildActivitySessions([first, second]))
    expect(summaries).toHaveLength(1)
    expect(summaries[0].sessions).toHaveLength(2)
    expect(summaries[0].totalDurationMs).toBe(120_000)
  })
})
