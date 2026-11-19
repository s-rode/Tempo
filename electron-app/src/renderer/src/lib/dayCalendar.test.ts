import { describe, expect, test } from 'bun:test'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { buildActivitySessions, type FocusTimelineRun } from './activitySessions'
import { buildDayCalendarBlocks, displaySegments, summarizeDayCalendarBlock } from './dayCalendar'

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

  test('a session left open since the night only spans the activity tracked in it', () => {
    const result = build([block('Anki', 555, 30, true)], [run('r1', 'Flashcards', -600, 600)])
    expect(result).toHaveLength(1)
    expect(result[0].startMs).toBe(at(555))
    expect(result[0].endMs).toBe(at(585))
  })

  test('a long sleep inside a session starts a new block with the same title', () => {
    const result = build(
      [block('Lecture 9', 0, 40, true), block('Lecture 9', 95, 30, true), block('Reddit', 133, 3, false)],
      [run('r1', 'Watch Formal Methods Lecture', 0, 140)]
    )
    expect(result.map((item) => [item.title, item.startMs, item.endMs, !!item.continued])).toEqual([
      ['Watch Formal Methods Lecture', at(0), at(40), false],
      ['Watch Formal Methods Lecture', at(95), at(136), true]
    ])
  })

  test('a short pause inside a session keeps one block', () => {
    const result = build(
      [block('Lecture 9', 0, 40, true), block('Lecture 9', 48, 30, true)],
      [run('r1', 'Watch lecture', 0, 80)]
    )
    expect(result).toHaveLength(1)
  })

  test('a session with nothing tracked is not drawn', () => {
    expect(build([], [run('r1', 'Reading', 0, 60)])).toHaveLength(0)
  })

  test('the summary sums work and distractions instead of listing every switch', () => {
    const [result] = build(
      [
        block('Code: Abend_Tickets.ipynb', 0, 3, true, 'Code'),
        block('Claude', 3, 1, undefined, 'Claude'),
        block('Code: Abend_Tickets.ipynb', 4, 2, true, 'Code'),
        block('Spring GDS', 6, 0.2, false),
        block('Code: Abend_Tickets.ipynb', 6.2, 5, true, 'Code'),
        block('pandas day name - Google Suche', 11.2, 0.2, true),
        block('Spring GDS', 11.4, 2, false),
        block('Code: Abend_Tickets.ipynb', 13.4, 4, true, 'Code')
      ],
      [run('r1', 'Data analysis homework', 0, 18)]
    )
    const groups = summarizeDayCalendarBlock(result)
    expect(groups.map((group) => group.state)).toEqual(['focused', 'distracted', 'uncertain'])
    const [work, distraction] = groups
    expect(work.rows[0].label).toBe('Code: Abend_Tickets.ipynb')
    expect(work.rows[0].durationMs).toBe(14 * 60_000)
    expect(work.rows[0].detail).toBe('Code · 4 times')
    expect(work.rows).toHaveLength(2)
    expect(distraction.rows).toHaveLength(1)
    expect(distraction.rows[0].label).toBe('Spring GDS')
    expect(distraction.rows[0].detail).toBe('Firefox · 2 times')
  })

  test('the drawn fill folds slivers into calm bands that keep their mix', () => {
    const blocks: ProcessedEventBlock[] = [block('Lecture 7', 0, 20, true)]
    for (let minute = 20; minute < 30; minute += 2) {
      blocks.push(block('Reddit', minute, 1, false))
      blocks.push(block('Lecture 7', minute + 1, 1, true))
    }
    blocks.push(block('Lecture 7', 30, 20, true))
    const [session] = build(blocks, [run('r1', 'Lecture', 0, 50)])
    expect(session.segments.length).toBeGreaterThan(8)
    const fill = displaySegments(session, 3 * 60_000)
    expect(fill.length).toBeLessThanOrEqual(3)
    expect(fill.some((segment) => segment.state === 'distracted')).toBe(true)
    expect(fill[0].startMs).toBe(at(0))
    expect(fill[fill.length - 1].endMs).toBe(at(50))
    for (let index = 1; index < fill.length; index += 1)
      expect(fill[index].state).not.toBe(fill[index - 1].state)
  })
})
