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

const focusRun = (minutes = 90): FocusTimelineRun => ({
  endedAtMs: base + minutes * 60_000,
  outcome: 'completed',
  run: {
    id: 'run',
    kind: 'custom',
    state: 'completed',
    currentPhaseIndex: 0,
    startedAtMs: base,
    completedAtMs: base + minutes * 60_000,
    phases: [
      {
        id: 'phase',
        kind: 'work',
        goal: 'Review lecture',
        startedAtMs: base,
        completedAtMs: base + minutes * 60_000,
        plannedDurationMs: minutes * 60_000,
        activeElapsedMs: minutes * 60_000,
        runningSinceMs: null,
        state: 'completed',
        productiveMs: 0,
        distractedMs: 0
      }
    ]
  }
})

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

  test('keeps sustained activity changes separate without an explicit goal', () => {
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
    expect(chapters).toHaveLength(2)
    expect(chapters.map((chapter) => chapter.focusedMs)).toEqual([10 * 60_000, 10 * 60_000])
    expect(chapters[1].boundaryReason).toBe('Activity changed')
  })

  test('summarizes a focus block by application while preserving its activity sequence', () => {
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
    const chapter = buildTimelineChapters(buildActivitySessions([firefox, remNote]), [
      focusRun()
    ])[0]
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

    const chapters = buildTimelineChapters(
      buildActivitySessions([productive, distraction]),
      runs,
      base + 20 * 60_000
    )
    expect(chapters).toHaveLength(2)
    expect(chapters[1].distractedMs).toBe(5 * 60_000)
    expect(chapters[1].focusGoal).toBeUndefined()

    expect(chapters[0].focusGoal).toMatchObject({
      goal: 'Review graphical models',
      focusedMs: 15 * 60_000,
      distractedMs: 0,
      adherence: 'on_track',
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

describe('meaningful timeline boundaries', () => {
  const at = (minute: number, duration: number, overrides: Partial<ProcessedEventBlock> = {}) =>
    block({
      startTime: new Date(base + minute * 60_000),
      endTime: new Date(base + (minute + duration) * 60_000),
      durationMs: duration * 60_000,
      ...overrides
    })
  const sessions = (blocks: ProcessedEventBlock[]) =>
    buildActivitySessions(blocks, { foldBrief: false })

  test('keeps a 70-minute goal together across apps and the old 30-minute boundary', () => {
    const input = sessions([
      at(0, 25),
      at(25, 20, {
        ownerName: 'Notes',
        originalEvent: { ...block().originalEvent, browser: null }
      }),
      at(45, 25)
    ])
    const chapters = buildTimelineChapters(input, [focusRun()])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].focusedMs).toBe(70 * 60_000)
    expect(chapters[0].focusGoal?.goal).toBe('Review lecture')
    expect(input).toHaveLength(3)
  })

  test('splits a continuous app session exactly at goal changes and conserves duration', () => {
    const run = focusRun(40)
    run.run.phases[0].goalHistory = [
      { goal: 'First task', todayPlanTask: null, startedAtMs: base },
      { goal: 'Second task', todayPlanTask: null, startedAtMs: base + 15 * 60_000 }
    ]
    const input = sessions([at(0, 40)])
    const chapters = buildTimelineChapters(input, [run])
    expect(chapters.map((chapter) => chapter.focusGoal?.goal)).toEqual([
      'First task',
      'Second task'
    ])
    expect(chapters.map((chapter) => chapter.focusedMs)).toEqual([15 * 60_000, 25 * 60_000])
    expect(input[0].activeDurationMs).toBe(40 * 60_000)
    expect(input[0].endTime).toEqual(new Date(base + 40 * 60_000))
  })

  test('keeps activity outside a recorded focus boundary separate', () => {
    const chapters = buildTimelineChapters(sessions([at(0, 60)]), [focusRun(30)])
    expect(chapters).toHaveLength(2)
    expect(chapters[0].focusGoal?.goal).toBe('Review lecture')
    expect(chapters[1].focusGoal).toBeUndefined()
    expect(chapters[1].focusedMs).toBe(30 * 60_000)
  })

  test('retains brief interruptions inside a goal with honest per-block totals', () => {
    const input = sessions([
      at(0, 10),
      at(10, 1, { ownerName: 'Mail', categoryId: 'distraction', isProductive: false }),
      at(11, 10)
    ])
    const chapters = buildTimelineChapters(input, [focusRun()])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].distractedMs).toBe(60_000)
    expect(chapters[0].sessions).toHaveLength(3)
    expect(chapters[0].focusGoal?.observedMs).toBe(21 * 60_000)
  })

  test('does not hide a sustained distraction made of many short app visits', () => {
    const input = sessions([
      at(0, 10),
      at(10, 1, { ownerName: 'Mail', categoryId: 'distraction', isProductive: false }),
      at(11, 1, { ownerName: 'Chat', categoryId: 'distraction', isProductive: false }),
      at(12, 10)
    ])
    const chapters = buildTimelineChapters(input, [focusRun()])
    expect(
      chapters
        .filter((chapter) => !chapter.focusGoal)
        .reduce((total, chapter) => total + chapter.distractedMs, 0)
    ).toBe(2 * 60_000)
    expect(chapters[chapters.length - 1].focusGoal?.goal).toBe('Review lecture')
  })

  test('bridges a quick return visit outside focus without losing the excursion', () => {
    const chapters = buildTimelineChapters(
      sessions([
        at(0, 10),
        at(10, 1, { activityLabel: 'Quick reference', title: 'Other page' }),
        at(11, 10)
      ])
    )
    expect(chapters).toHaveLength(1)
    expect(chapters[0].sessions).toHaveLength(3)
    expect(chapters[0].focusedMs).toBe(21 * 60_000)
  })

  test('uses block totals after a gap rather than repeating the whole phase score', () => {
    const chapters = buildTimelineChapters(sessions([at(0, 10), at(15, 20)]), [focusRun()])
    expect(chapters).toHaveLength(2)
    expect(chapters.map((chapter) => chapter.focusGoal?.focusedMs)).toEqual([
      10 * 60_000,
      20 * 60_000
    ])
    expect(chapters[1].boundaryReason).toBe('Resumed after a gap')
  })
})

test('a goal change during an untracked gap allocates only the recorded activity on each side', () => {
  const first = block({ durationMs: 10 * 60_000, endTime: new Date(base + 10 * 60_000) })
  const next = block({
    startTime: new Date(base + 12 * 60_000),
    endTime: new Date(base + 22 * 60_000),
    durationMs: 10 * 60_000
  })
  const run = focusRun(22)
  run.run.phases[0].goalHistory = [
    { goal: 'Before gap', todayPlanTask: null, startedAtMs: base },
    { goal: 'After gap', todayPlanTask: null, startedAtMs: base + 11 * 60_000 }
  ]
  const input = buildActivitySessions([first, next], { foldBrief: false })
  expect(input).toHaveLength(1)
  const chapters = buildTimelineChapters(input, [run])
  expect(chapters.map((chapter) => chapter.focusedMs)).toEqual([10 * 60_000, 10 * 60_000])
  expect(chapters[0].endTime).toEqual(new Date(base + 10 * 60_000))
  expect(chapters[1].startTime).toEqual(new Date(base + 12 * 60_000))
  expect(chapters[1].sessions[0].sourceBlocks[0].eventIds).toEqual(next.eventIds)
})

test('keeps seconds-long timer-boundary transitions with the preceding block, conserving every state', () => {
  const run = focusRun(10)
  const input = buildActivitySessions(
    [
      block({ durationMs: 10 * 60_000, endTime: new Date(base + 10 * 60_000) }),
      block({
        startTime: new Date(base + 10 * 60_000),
        durationMs: 200,
        endTime: new Date(base + 10 * 60_000 + 200)
      }),
      block({
        startTime: new Date(base + 10 * 60_000 + 200),
        durationMs: 1000,
        endTime: new Date(base + 10 * 60_000 + 1200),
        ownerName: 'Chat',
        isProductive: undefined,
        categoryId: 'uncertain'
      }),
      block({
        startTime: new Date(base + 10 * 60_000 + 1200),
        durationMs: 2000,
        endTime: new Date(base + 10 * 60_000 + 3200),
        ownerName: 'Mail',
        isProductive: false,
        categoryId: 'distraction'
      })
    ],
    { foldBrief: false }
  )
  const chapters = buildTimelineChapters(input, [run])
  expect(chapters).toHaveLength(1)
  expect(chapters[0].focusedMs).toBe(600200)
  expect(chapters[0].distractedMs).toBe(2000)
  expect(chapters[0].uncertainMs).toBe(1000)
  expect(chapters[0].focusGoal?.goal).toBe('Review lecture')
})

test('keeps the same goal together across timer restarts but retains distinct goals and gaps', () => {
  const first = focusRun(20)
  const second = focusRun(40)
  second.run.id = 'next-run'
  second.run.phases[0].startedAtMs = base + 20 * 60_000
  const third = focusRun(60)
  third.run.id = 'third-run'
  third.run.phases[0].startedAtMs = base + 40 * 60_000
  const input = buildActivitySessions(
    [block({ durationMs: 60 * 60_000, endTime: new Date(base + 60 * 60_000) })],
    { foldBrief: false }
  )
  const chapters = buildTimelineChapters(input, [first, second, third])
  expect(chapters).toHaveLength(1)
  expect(chapters[0].focusGoal?.runIds).toEqual(['run', 'next-run', 'third-run'])
  expect(chapters[0].focusedMs).toBe(60 * 60_000)
  expect(chapters[0].focusGoal?.focusedMs).toBe(60 * 60_000)
  third.run.phases[0].goal = 'A different task'
  expect(buildTimelineChapters(input, [first, second, third])).toHaveLength(2)
})
