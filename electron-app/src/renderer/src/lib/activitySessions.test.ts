import { describe, expect, test } from 'bun:test'
import type { ProcessedEventBlock } from '../components/DashboardView'
import {
  attachFocusGoalsToTimelineChapters,
  buildActivitySessions,
  buildDayActivitySummaries,
  buildTimelineChapters,
  sessionTotals,
  summarizeTimelineChapterApps,
  type FocusTimelineRun
} from './activitySessions'

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
      originalEvent: {
        ...block().originalEvent,
        ownerName: 'RemNote',
        title: 'Graphical Models flashcards',
        type: 'window',
        browser: null
      }
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
      originalEvent: {
        ...first.originalEvent,
        ownerName: 'Signal',
        title: 'Signal',
        type: 'window',
        browser: null,
        categoryId: 'distraction'
      }
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
    const first = block({
      ownerName: 'Google Chrome',
      title: 'Study notes',
      url: 'https://local.test/study',
      durationMs: 120_000,
      endTime: new Date(base + 120_000),
      originalEvent: {
        ...block().originalEvent,
        ownerName: 'Google Chrome',
        title: 'Study notes',
        browser: 'chrome'
      }
    })
    const brief = block({
      ownerName: 'Google Chrome',
      title: 'Quick reference',
      url: 'https://local.test/reference',
      activityKey: 'chrome:reference',
      activityLabel: 'Quick reference',
      durationMs: 20_000,
      startTime: new Date(base + 120_000),
      endTime: new Date(base + 140_000),
      originalEvent: { ...first.originalEvent, title: 'Quick reference', browser: 'chrome' }
    })
    const sessions = buildActivitySessions([first, brief])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].briefActivities).toHaveLength(1)
    expect(sessionTotals(sessions).focusedMs).toBe(140_000)
  })

  test('aggregates repeat visits into one summary row while preserving sessions', () => {
    const first = block()
    const second = block({
      startTime: new Date(base + 5 * 60_000),
      endTime: new Date(base + 6 * 60_000)
    })
    const summaries = buildDayActivitySummaries(buildActivitySessions([first, second]))
    expect(summaries).toHaveLength(1)
    expect(summaries[0].sessions).toHaveLength(2)
    expect(summaries[0].totalDurationMs).toBe(120_000)
  })

  test('uses one inspector source per app while retaining its focus-state mix', () => {
    const focusedFirefox = block({
      title: 'Lecture notes',
      activityKey: 'firefox:lecture',
      activityLabel: 'Lecture notes',
      durationMs: 4 * 60_000,
      endTime: new Date(base + 4 * 60_000)
    })
    const distractedFirefox = block({
      title: 'Unrelated browsing',
      activityKey: 'firefox:unrelated',
      activityLabel: 'Unrelated browsing',
      categoryId: 'distraction',
      categoryName: 'Distraction',
      isProductive: false,
      durationMs: 2 * 60_000,
      startTime: new Date(base + 4 * 60_000),
      endTime: new Date(base + 6 * 60_000),
      originalEvent: {
        ...focusedFirefox.originalEvent,
        title: 'Unrelated browsing',
        categoryId: 'distraction'
      }
    })

    const summaries = buildDayActivitySummaries(
      buildActivitySessions([focusedFirefox, distractedFirefox])
    )

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      ownerName: 'Firefox',
      focusedMs: 4 * 60_000,
      distractedMs: 2 * 60_000,
      uncertainMs: 0,
      totalDurationMs: 6 * 60_000
    })
    expect(summaries[0].sessions).toHaveLength(2)
  })

  test('groups short activity switches into a readable 30-minute chapter', () => {
    const first = block({ durationMs: 10 * 60_000, endTime: new Date(base + 10 * 60_000) })
    const second = block({
      ownerName: 'RemNote',
      activityKey: 'app:remnote',
      activityLabel: 'Flashcards',
      startTime: new Date(base + 10 * 60_000),
      endTime: new Date(base + 20 * 60_000),
      durationMs: 10 * 60_000,
      originalEvent: { ...first.originalEvent, ownerName: 'RemNote', type: 'window', browser: null }
    })
    const chapters = buildTimelineChapters(buildActivitySessions([first, second]))
    expect(chapters).toHaveLength(1)
    expect(chapters[0].focusedMs).toBe(20 * 60_000)
    expect(chapters[0].sessions).toHaveLength(2)
  })

  test('summarizes a chapter by application without exposing page-level sessions', () => {
    const firefox = block({ durationMs: 10 * 60_000, endTime: new Date(base + 10 * 60_000) })
    const remNote = block({
      ownerName: 'RemNote',
      activityKey: 'app:remnote',
      activityLabel: 'Flashcards',
      durationMs: 5 * 60_000,
      startTime: new Date(base + 10 * 60_000),
      endTime: new Date(base + 15 * 60_000),
      originalEvent: {
        ...firefox.originalEvent,
        ownerName: 'RemNote',
        type: 'window',
        browser: null
      }
    })
    const chapter = buildTimelineChapters(buildActivitySessions([firefox, remNote]))[0]
    expect(summarizeTimelineChapterApps(chapter)).toEqual([
      { appName: 'Firefox', durationMs: 10 * 60_000, sessionCount: 1 },
      { appName: 'RemNote', durationMs: 5 * 60_000, sessionCount: 1 }
    ])
  })

  test('splits chapters at a five-minute tracking gap', () => {
    const first = block()
    const later = block({
      startTime: new Date(base + 6 * 60_000),
      endTime: new Date(base + 7 * 60_000)
    })
    expect(buildTimelineChapters(buildActivitySessions([first, later]))).toHaveLength(2)
  })

  test('annotates a manual focus goal with classified adherence, not timer duration', () => {
    const productive = block({
      durationMs: 15 * 60_000,
      endTime: new Date(base + 15 * 60_000)
    })
    const distraction = block({
      ownerName: 'Messages',
      activityKey: 'app:messages',
      activityLabel: 'Messages',
      durationMs: 5 * 60_000,
      startTime: new Date(base + 15 * 60_000),
      endTime: new Date(base + 20 * 60_000),
      categoryId: 'distraction',
      categoryName: 'Distraction',
      isProductive: false,
      originalEvent: {
        ...productive.originalEvent,
        ownerName: 'Messages',
        browser: null,
        type: 'window',
        categoryId: 'distraction'
      }
    })
    const runs: FocusTimelineRun[] = [
      {
        endedAtMs: base + 20 * 60_000,
        outcome: 'completed',
        run: {
          id: 'focus-run',
          kind: 'custom',
          state: 'completed',
          currentPhaseIndex: 0,
          startedAtMs: base,
          completedAtMs: base + 20 * 60_000,
          phases: [
            {
              id: 'work-phase',
              kind: 'work',
              goal: 'Review graphical models',
              startedAtMs: base,
              completedAtMs: base + 20 * 60_000,
              plannedDurationMs: 20 * 60_000,
              activeElapsedMs: 20 * 60_000,
              runningSinceMs: null,
              state: 'completed',
              productiveMs: 0,
              distractedMs: 0
            }
          ]
        }
      }
    ]

    const chapters = attachFocusGoalsToTimelineChapters(
      buildTimelineChapters(buildActivitySessions([productive, distraction])),
      runs,
      base + 20 * 60_000
    )

    expect(chapters[0].focusGoal).toMatchObject({
      goal: 'Review graphical models',
      focusedMs: 15 * 60_000,
      distractedMs: 5 * 60_000,
      adherence: 'mostly_on_track',
      isLead: true
    })
  })

  test('keeps a distraction chapter honest instead of inheriting an overlapping focus goal', () => {
    const focused = block({
      durationMs: 10 * 60_000,
      endTime: new Date(base + 10 * 60_000)
    })
    const chatGptDistraction = block({
      ownerName: 'ChatGPT',
      title: 'ChatGPT',
      activityKey: 'app:chatgpt',
      // This reproduces stale enrichment from an earlier focus context. The
      // category, not this field, must determine the presented label.
      activityLabel: 'Study Focus',
      durationMs: 12 * 60_000,
      startTime: new Date(base + 16 * 60_000),
      endTime: new Date(base + 28 * 60_000),
      categoryId: 'distraction',
      categoryName: 'Distraction',
      isProductive: false,
      originalEvent: {
        ...focused.originalEvent,
        ownerName: 'ChatGPT',
        title: 'ChatGPT',
        type: 'window',
        browser: null,
        categoryId: 'distraction'
      }
    })
    const runs: FocusTimelineRun[] = [
      {
        endedAtMs: base + 30 * 60_000,
        outcome: 'completed',
        run: {
          id: 'focus-run',
          kind: 'custom',
          state: 'completed',
          currentPhaseIndex: 0,
          startedAtMs: base,
          completedAtMs: base + 30 * 60_000,
          phases: [
            {
              id: 'work-phase',
              kind: 'work',
              goal: 'Organize life calendar and journal',
              startedAtMs: base,
              completedAtMs: base + 30 * 60_000,
              plannedDurationMs: 30 * 60_000,
              activeElapsedMs: 30 * 60_000,
              runningSinceMs: null,
              state: 'completed',
              productiveMs: 0,
              distractedMs: 0
            }
          ]
        }
      }
    ]

    const chapters = attachFocusGoalsToTimelineChapters(
      buildTimelineChapters(buildActivitySessions([focused, chatGptDistraction])),
      runs,
      base + 30 * 60_000
    )

    expect(chapters).toHaveLength(2)
    expect(chapters[0].focusGoal?.goal).toBe('Organize life calendar and journal')
    expect(chapters[1].focusGoal).toBeUndefined()
    expect(chapters[1].label).toBe('Distracted by ChatGPT')
    expect(chapters[1].summary).toBe('Does not support the current goal.')
  })

  test('does not attach a focus goal outside its recorded work-phase boundary', () => {
    const chapters = buildTimelineChapters(buildActivitySessions([block()]))
    const runs: FocusTimelineRun[] = [
      {
        endedAtMs: base + 30 * 60_000,
        outcome: 'completed',
        run: {
          id: 'later-focus-run',
          kind: 'custom',
          state: 'completed',
          currentPhaseIndex: 0,
          startedAtMs: base + 20 * 60_000,
          completedAtMs: base + 30 * 60_000,
          phases: [
            {
              id: 'later-work-phase',
              kind: 'work',
              goal: 'Later work',
              startedAtMs: base + 20 * 60_000,
              completedAtMs: base + 30 * 60_000,
              plannedDurationMs: 10 * 60_000,
              activeElapsedMs: 10 * 60_000,
              runningSinceMs: null,
              state: 'completed',
              productiveMs: 0,
              distractedMs: 0
            }
          ]
        }
      }
    ]
    expect(
      attachFocusGoalsToTimelineChapters(chapters, runs, base + 30 * 60_000)[0].focusGoal
    ).toBeUndefined()
  })

  test('keeps separate timeline goals when a running work phase changes task', () => {
    const first = block({
      durationMs: 10 * 60_000,
      startTime: new Date(base),
      endTime: new Date(base + 10 * 60_000)
    })
    const second = block({
      durationMs: 5 * 60_000,
      startTime: new Date(base + 15 * 60_000),
      endTime: new Date(base + 20 * 60_000)
    })
    const runs: FocusTimelineRun[] = [
      {
        endedAtMs: base + 20 * 60_000,
        outcome: 'completed',
        run: {
          id: 'changed-goal-run',
          kind: 'custom',
          state: 'completed',
          currentPhaseIndex: 0,
          startedAtMs: base,
          completedAtMs: base + 20 * 60_000,
          phases: [
            {
              id: 'changed-goal-phase',
              kind: 'work',
              goal: 'Practice interview questions',
              goalHistory: [
                { goal: 'Review flashcards', todayPlanTask: null, startedAtMs: base },
                {
                  goal: 'Practice interview questions',
                  todayPlanTask: null,
                  startedAtMs: base + 10 * 60_000
                }
              ],
              startedAtMs: base,
              completedAtMs: base + 20 * 60_000,
              plannedDurationMs: 20 * 60_000,
              activeElapsedMs: 20 * 60_000,
              runningSinceMs: null,
              state: 'completed',
              productiveMs: 0,
              distractedMs: 0
            }
          ]
        }
      }
    ]

    const chapters = attachFocusGoalsToTimelineChapters(
      buildTimelineChapters(buildActivitySessions([first, second])),
      runs,
      base + 20 * 60_000
    )

    expect(chapters[0].focusGoal?.goal).toBe('Review flashcards')
    expect(chapters[1].focusGoal?.goal).toBe('Practice interview questions')
  })
})
