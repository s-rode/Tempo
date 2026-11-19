import {
  adherenceFor,
  focusGoalCandidates,
  TIMELINE_GAP_MS,
  type ActivitySessionBlock,
  type FocusGoalAdherence,
  type FocusTimelineRun
} from './activitySessions'

export type DayCalendarState = 'focused' | 'distracted' | 'uncertain'

/** A stretch of one activity inside a block, in time order. */
export interface DayCalendarActivity {
  startMs: number
  endMs: number
  durationMs: number
  label: string
  appName: string
  state: DayCalendarState
  visits: number
  session: ActivitySessionBlock
}

export interface DayCalendarSegment {
  startMs: number
  endMs: number
  state: DayCalendarState
}

/**
 * One block of the Timeline calendar.  A `focus` block is a focus session the
 * person started, titled with its goal, and holds everything that happened
 * while it ran, distractions included.  A `free` block is tracked time with no
 * session running; it is never split by app switches, only by an idle gap or
 * a focus session.
 */
export interface DayCalendarBlock {
  id: string
  kind: 'focus' | 'free'
  title: string
  startMs: number
  endMs: number
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  segments: DayCalendarSegment[]
  activities: DayCalendarActivity[]
  sessions: ActivitySessionBlock[]
  focus?: {
    goal: string
    kind: 'custom' | 'pomodoro'
    taskId?: string
    runIds: string[]
    adherence: FocusGoalAdherence
    adherenceLabel: string
  }
}

interface Piece {
  startMs: number
  endMs: number
  durationMs: number
  state: DayCalendarState
  session: ActivitySessionBlock
}

interface FocusInterval {
  startMs: number
  endMs: number
  goal: string
  kind: 'custom' | 'pomodoro'
  taskId?: string
  runIds: string[]
}

// A free stretch shorter than this, next to a focus session, is the hand-over
// before or after the timer rather than time of its own.
const FREE_BLOCK_MIN_MS = 2 * 60 * 1000
// Activity pieces closer than this read as one continuous stripe.
const SEGMENT_JOIN_MS = 30 * 1000

const stateOf = (session: ActivitySessionBlock): DayCalendarState =>
  session.isProductive === true
    ? 'focused'
    : session.isProductive === false
      ? 'distracted'
      : 'uncertain'

const activityLabel = (session: ActivitySessionBlock) =>
  (session.isProductive === false ? session.title?.trim() : '') || session.label

const focusIntervals = (runs: FocusTimelineRun[], nowMs: number): FocusInterval[] => {
  const intervals: FocusInterval[] = []
  const candidates = focusGoalCandidates(runs, nowMs).sort(
    (left, right) => +left.startTime - +right.startTime
  )
  for (const candidate of candidates) {
    const previous = intervals[intervals.length - 1]
    const startMs = +candidate.startTime
    const endMs = Math.min(+candidate.endTime, nowMs)
    if (endMs <= startMs) continue
    // The same goal continued, through a queue switch, a resumed run or a
    // short break, stays one session block.
    if (
      previous &&
      previous.goal.toLowerCase() === candidate.goal.toLowerCase() &&
      startMs - previous.endMs < TIMELINE_GAP_MS
    ) {
      previous.endMs = Math.max(previous.endMs, endMs)
      if (!previous.runIds.includes(candidate.runId)) previous.runIds.push(candidate.runId)
      continue
    }
    if (previous && startMs < previous.endMs) previous.endMs = startMs
    intervals.push({
      startMs,
      endMs,
      goal: candidate.goal,
      kind: candidate.kind,
      taskId: candidate.taskId,
      runIds: [candidate.runId]
    })
  }
  return intervals
}

/** Cuts each session's source blocks at session boundaries, so every piece lies in one block. */
const piecesFor = (sessions: ActivitySessionBlock[], cuts: number[]): Piece[] =>
  sessions.flatMap((session) => {
    const sources = session.sourceBlocks.length
      ? session.sourceBlocks
      : [
          {
            startTime: session.startTime,
            endTime: session.endTime,
            durationMs: session.activeDurationMs
          }
        ]
    return sources.flatMap((source) => {
      const start = +source.startTime
      const end = +source.endTime
      const span = Math.max(1, end - start)
      const points = [start, ...cuts.filter((point) => point > start && point < end), end]
      return points.slice(0, -1).flatMap((point, index) => {
        const next = points[index + 1]
        const durationMs = (source.durationMs * (next - point)) / span
        return durationMs > 0
          ? [{ startMs: point, endMs: next, durationMs, state: stateOf(session), session }]
          : []
      })
    })
  })

const makeBlock = (
  kind: DayCalendarBlock['kind'],
  pieces: Piece[],
  startMs: number,
  endMs: number,
  interval?: FocusInterval
): DayCalendarBlock => {
  const sorted = [...pieces].sort((left, right) => left.startMs - right.startMs)
  const totals = { focused: 0, distracted: 0, uncertain: 0 }
  const segments: DayCalendarSegment[] = []
  const activities: DayCalendarActivity[] = []
  const sessions: ActivitySessionBlock[] = []
  const timeByLabel = new Map<string, number>()
  for (const piece of sorted) {
    totals[piece.state] += piece.durationMs
    if (!sessions.includes(piece.session)) sessions.push(piece.session)
    const label = activityLabel(piece.session)
    if (piece.state === 'focused')
      timeByLabel.set(label, (timeByLabel.get(label) || 0) + piece.durationMs)

    const segment = segments[segments.length - 1]
    if (segment && segment.state === piece.state && piece.startMs - segment.endMs < SEGMENT_JOIN_MS)
      segment.endMs = Math.max(segment.endMs, piece.endMs)
    else segments.push({ startMs: piece.startMs, endMs: piece.endMs, state: piece.state })

    const activity = activities[activities.length - 1]
    // Hopping between distracting pages of one app reads as one row
    // ("Reddit · 4 visits"), not a row per page.
    if (
      activity &&
      activity.state === piece.state &&
      (activity.label === label ||
        (piece.state !== 'focused' && activity.appName === piece.session.ownerName))
    ) {
      if (activity.session !== piece.session) activity.visits += 1
      activity.endMs = Math.max(activity.endMs, piece.endMs)
      activity.durationMs += piece.durationMs
      activity.session = piece.session
    } else {
      activities.push({
        startMs: piece.startMs,
        endMs: piece.endMs,
        durationMs: piece.durationMs,
        label,
        appName: piece.session.ownerName,
        state: piece.state,
        visits: 1,
        session: piece.session
      })
    }
  }
  const topLabel = [...timeByLabel.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  const apps = [...new Set(sorted.map((piece) => piece.session.ownerName))]
  return {
    id: `${kind}:${startMs}`,
    kind,
    title: interval?.goal || topLabel || apps.slice(0, 2).join(', ') || 'Activity',
    startMs,
    endMs,
    focusedMs: totals.focused,
    distractedMs: totals.distracted,
    uncertainMs: totals.uncertain,
    segments,
    activities,
    sessions,
    focus: interval && {
      goal: interval.goal,
      kind: interval.kind,
      taskId: interval.taskId,
      runIds: interval.runIds,
      ...adherenceFor(totals.focused, totals.distracted, totals.uncertain)
    }
  }
}

export const trackedMs = (block: DayCalendarBlock) =>
  block.focusedMs + block.distractedMs + block.uncertainMs

/** The day as calendar blocks: focus sessions, and the tracked time between them. */
export const buildDayCalendarBlocks = (
  sessions: ActivitySessionBlock[],
  runs: FocusTimelineRun[] = [],
  nowMs = Date.now()
): DayCalendarBlock[] => {
  const intervals = focusIntervals(runs, nowMs)
  const cuts = [...new Set(intervals.flatMap((item) => [item.startMs, item.endMs]))]
  const pieces = piecesFor(sessions, cuts).sort((left, right) => left.startMs - right.startMs)

  const focusPieces = intervals.map(() => [] as Piece[])
  const freeGroups: Piece[][] = []
  for (const piece of pieces) {
    const middle = (piece.startMs + piece.endMs) / 2
    const index = intervals.findIndex((item) => item.startMs <= middle && middle < item.endMs)
    if (index >= 0) {
      focusPieces[index].push(piece)
      continue
    }
    const group = freeGroups[freeGroups.length - 1]
    const last = group?.[group.length - 1]
    const sessionBetween =
      last && intervals.some((item) => item.startMs >= last.endMs && item.startMs < piece.startMs)
    if (!group || sessionBetween || piece.startMs - last.endMs >= TIMELINE_GAP_MS)
      freeGroups.push([piece])
    else group.push(piece)
  }

  const focusRanges = intervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs }))
  const freeBlocks: DayCalendarBlock[] = []
  for (const group of freeGroups) {
    const startMs = group[0].startMs
    const endMs = Math.max(...group.map((piece) => piece.endMs))
    const tracked = group.reduce((total, piece) => total + piece.durationMs, 0)
    const nearest = focusRanges
      .map((range, index) => ({
        index,
        distance: Math.max(range.startMs - endMs, startMs - range.endMs)
      }))
      .filter((item) => item.distance < TIMELINE_GAP_MS)
      .sort((left, right) => left.distance - right.distance)[0]
    if (tracked < FREE_BLOCK_MIN_MS && nearest) {
      focusPieces[nearest.index].push(...group)
      const range = focusRanges[nearest.index]
      range.startMs = Math.min(range.startMs, startMs)
      range.endMs = Math.max(range.endMs, endMs)
      continue
    }
    freeBlocks.push(makeBlock('free', group, startMs, endMs))
  }

  // A session block spans the activity tracked while it ran. A run that was
  // left open (or began on another day) therefore never paints hours of
  // empty session, and a session with nothing tracked is not drawn.
  const focusBlocks = intervals.flatMap((interval, index) => {
    const own = focusPieces[index]
    if (!own.length) return []
    return [
      makeBlock(
        'focus',
        own,
        Math.min(...own.map((piece) => piece.startMs)),
        Math.max(...own.map((piece) => piece.endMs)),
        interval
      )
    ]
  })
  return [...focusBlocks, ...freeBlocks].sort((left, right) => left.startMs - right.startMs)
}

/** One line of a block summary: an activity, site or app and the time it took. */
export interface DayCalendarSummaryRow {
  key: string
  label: string
  detail: string
  durationMs: number
  /** The longest stretch, so the row can open it in the inspector. */
  session: ActivitySessionBlock
}

export interface DayCalendarSummaryGroup {
  state: DayCalendarState
  totalMs: number
  rows: DayCalendarSummaryRow[]
}

const SUMMARY_ROWS = 4
const SUMMARY_MIN_ROW_MS = 60 * 1000

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

// Work is named by what it was ("Code: Abend_Tickets.ipynb"); a distraction
// by where it happened (the site or the app), which is what you would avoid.
const summaryName = (activity: DayCalendarActivity) => {
  const { session } = activity
  if (activity.state === 'focused') return activity.label
  if (activity.state === 'uncertain') return session.ownerName
  // "Reddit – thread" and "Reddit – front page" are one site.
  const page = session.browser ? session.title?.split(/ [–—|-] /)[0]?.trim() : ''
  return hostOf(session.url) || page || session.ownerName
}

/**
 * A block reduced to a few lines: what you worked on and what distracted
 * you, each summed across the block and longest first.  Anything under a
 * minute beyond the top lines folds into one "Other" line.
 */
export const summarizeDayCalendarBlock = (block: DayCalendarBlock): DayCalendarSummaryGroup[] =>
  (['focused', 'distracted', 'uncertain'] as const).flatMap((state) => {
    const groups = new Map<
      string,
      {
        label: string
        apps: Set<string>
        count: number
        durationMs: number
        longest: DayCalendarActivity
      }
    >()
    for (const activity of block.activities.filter((item) => item.state === state)) {
      const label = summaryName(activity)
      const key = label.toLowerCase()
      const group = groups.get(key)
      if (group) {
        group.durationMs += activity.durationMs
        group.count += activity.visits
        group.apps.add(activity.appName)
        if (activity.durationMs > group.longest.durationMs) group.longest = activity
      } else {
        groups.set(key, {
          label,
          apps: new Set([activity.appName]),
          count: activity.visits,
          durationMs: activity.durationMs,
          longest: activity
        })
      }
    }
    const sorted = [...groups.entries()].sort(
      (left, right) => right[1].durationMs - left[1].durationMs
    )
    if (!sorted.length) return []
    const kept = sorted.filter(
      ([, group], index) =>
        index === 0 || (index < SUMMARY_ROWS && group.durationMs >= SUMMARY_MIN_ROW_MS)
    )
    const rest = sorted.slice(kept.length)
    const rows: DayCalendarSummaryRow[] = kept.map(([key, group]) => {
      const apps = [...group.apps].filter((app) => app !== group.label)
      return {
        key,
        label: group.label,
        detail: [apps.join(', '), group.count > 1 ? `${group.count} times` : '']
          .filter(Boolean)
          .join(' · '),
        durationMs: group.durationMs,
        session: group.longest.session
      }
    })
    if (rest.length) {
      const longest = rest.reduce((best, item) =>
        item[1].durationMs > best[1].durationMs ? item : best
      )[1].longest
      rows.push({
        key: 'other',
        label: rest.length === 1 ? rest[0][1].label : `${rest.length} other things`,
        detail:
          rest.length === 1
            ? [...rest[0][1].apps].join(', ')
            : rest
                .slice(0, 3)
                .map(([, group]) => group.label)
                .join(', ') + (rest.length > 3 ? ', …' : ''),
        durationMs: rest.reduce((total, [, group]) => total + group.durationMs, 0),
        session: longest.session
      })
    }
    return [{ state, totalMs: rows.reduce((total, row) => total + row.durationMs, 0), rows }]
  })
