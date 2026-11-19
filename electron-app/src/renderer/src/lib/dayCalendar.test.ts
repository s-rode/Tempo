import { describe, expect, test } from 'bun:test'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { buildActivitySessions, type FocusTimelineRun } from './activitySessions'
import { buildDayCalendarBlocks } from './dayCalendar'

const base = new Date('2026-11-19T08:00:00.000Z').getTime()
const at = (minute: number, second = 0) => base + minute * 60_000 + second * 1000

const block = (
  title: string,
  startMinute: number,
  minutes: number,
  isProductive: boolean | undefined,
  ownerName = 'Firefox'
): ProcessedEventBlock => {
  const start = at(startMinute)
  return {
    startTime: new Date(start),
    endTime: new Date(start + minutes * 60_000),
    durationMs: minutes * 60_000,
    name: title,
    ownerName,
    title,
    activityKey: `${ownerName}:${title}`,
    activityLabel: title,
    categoryId: isProductive === undefined ? null : isProductive ? 'work' : 'fun',
    isProductive,
    eventIds: [`${title}:${start}`],
    originalEvent: {
      eventId: `${title}:${start}`,
      timestamp: start,
      ownerName,
      title,
      type: 'browser',
      browser: ownerName === 'Firefox' ? 'firefox' : null
    } as ProcessedEventBlock['originalEvent']
  }
}

const run = (
  id: string,
  goal: string,
  startMinute: number,
  endMinute: number
): FocusTimelineRun => ({
  endedAtMs: at(endMinute),
  outcome: 'completed',
  run: {
    id,
    kind: 'custom',
    state: 'completed',
    currentPhaseIndex: 0,
    startedAtMs: at(startMinute),
    completedAtMs: at(endMinute),
    phases: [
      {
        id: `${id}:work`,
        kind: 'work',
        goal,
        startedAtMs: at(startMinute),
        completedAtMs: at(endMinute),
        plannedDurationMs: (endMinute - startMinute) * 60_000,
        activeElapsedMs: (endMinute - startMinute) * 60_000,
        runningSinceMs: null,
        state: 'completed',
        productiveMs: 0,
        distractedMs: 0
      }
    ]
  } as FocusTimelineRun['run']
})

const build = (blocks: ProcessedEventBlock[], runs: FocusTimelineRun[] = []) =>
  buildDayCalendarBlocks(buildActivitySessions(blocks, { foldBrief: false }), runs, at(600))

describe('day calendar blocks', () => {
  test('a focus session holds its distractions instead of splitting around them', () => {
    const result = build(
      [
        block('Lecture 7', 0, 18, true),
        block('Reddit', 18, 2, false),
        block('Lecture 7', 20, 17, true),
        block('Reddit thread', 37, 2, false)
      ],
      [run('r1', 'Watch Data Science lecture', 0, 40)]
    )
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('focus')
    expect(result[0].title).toBe('Watch Data Science lecture')
    expect(result[0].focusedMs).toBe(35 * 60_000)
    expect(result[0].distractedMs).toBe(4 * 60_000)
    expect(result[0].segments.map((segment) => segment.state)).toEqual([
      'focused',
      'distracted',
      'focused',
      'distracted'
    ])
  })

  test('time without a session is one block however often the app changes', () => {
    const result = build([
      block('Slack', 0, 2, undefined, 'Slack'),
      block('Messages', 2, 1, false, 'Messages'),
      block('Notes', 3, 4, true, 'Notes'),
      block('Reddit', 7, 1, false),
      block('Notes', 8, 3, true, 'Notes')
    ])
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('free')
    expect(result[0].title).toBe('Notes')
    expect(result[0].activities).toHaveLength(5)
  })

  test('an idle gap leaves blank time between blocks', () => {
    const result = build([
      block('Notes', 0, 10, true, 'Notes'),
      block('Notes', 30, 10, true, 'Notes')
    ])
    expect(result.map((item) => item.startMs)).toEqual([at(0), at(30)])
  })

  test('a queue switch to the same goal, and seconds around a session, stay in the session', () => {
    const result = build(
      [
        block('Anki', 9, 1, true),
        block('Lecture', 10, 20, true),
        block('Lecture', 30, 10, true),
        block('YouTube', 40, 1, false)
      ],
      [run('r1', 'Lecture', 10, 30), run('r2', 'Lecture', 30, 40)]
    )
    expect(result).toHaveLength(1)
    expect(result[0].focus?.runIds).toEqual(['r1', 'r2'])
    expect(result[0].startMs).toBe(at(9))
    expect(result[0].endMs).toBe(at(41))
  })

  test('different sessions back to back stay apart', () => {
    const result = build(
      [block('Lecture', 0, 20, true), block('Anki', 20, 10, true)],
      [run('r1', 'Watch lecture', 0, 20), run('r2', 'Flashcards', 20, 30)]
    )
    expect(result.map((item) => item.title)).toEqual(['Watch lecture', 'Flashcards'])
  })
})
