import type { ActivitySessionBlock } from './activitySessions'

const HOUR_MS = 3_600_000

export type DayOverviewState = 'focused' | 'distracted' | 'uncertain'

export interface DayOverviewSegment {
  session: ActivitySessionBlock
  state: DayOverviewState
  startMs: number
  endMs: number
  /** Position within the hour row, from 0 to 1. */
  offset: number
  width: number
}

export interface DayOverviewRow {
  hourStartMs: number
  segments: DayOverviewSegment[]
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  idleMs: number
}

export interface DayOverview {
  startMs: number
  endMs: number
  rows: DayOverviewRow[]
  focusedMs: number
  distractedMs: number
  uncertainMs: number
  idleMs: number
}

export const sessionState = (session: ActivitySessionBlock): DayOverviewState =>
  session.isProductive === true
    ? 'focused'
    : session.isProductive === false
      ? 'distracted'
      : 'uncertain'

/**
 * One row per local clock hour from the first to the last tracked activity.
 * Rows are built from real timestamps, so DST days get 23 or 25 rows and
 * overnight sessions clip to the selected day. Idle time is elapsed time in the
 * range that no session covers.
 */
export function buildDayOverview(date: Date, sessions: ActivitySessionBlock[]): DayOverview | null {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  const clipped = [...sessions]
    .map((session) => ({
      session,
      start: Math.max(dayStart, +session.startTime),
      end: Math.min(dayEnd, +session.endTime)
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  if (!clipped.length) return null

  // Hour boundaries come from Date arithmetic rather than fixed offsets so a
  // DST transition keeps rows aligned with the wall clock.
  const hourFloor = (ms: number) => {
    const value = new Date(ms)
    value.setMinutes(0, 0, 0)
    return value.getTime()
  }
  const startMs = hourFloor(clipped[0].start)
  const lastEnd = Math.max(...clipped.map((item) => item.end))
  const boundaries = [startMs]
  while (boundaries[boundaries.length - 1] < lastEnd) {
    const point = boundaries[boundaries.length - 1]
    const next = new Date(point)
    next.setHours(next.getHours() + 1)
    boundaries.push(Math.min(dayEnd, next.getTime() > point ? next.getTime() : point + HOUR_MS))
  }
  const endMs = boundaries[boundaries.length - 1]

  const rows = boundaries.slice(0, -1).map((hourStartMs, index): DayOverviewRow => {
    const hourEndMs = boundaries[index + 1]
    const length = hourEndMs - hourStartMs
    const row: DayOverviewRow = {
      hourStartMs,
      segments: [],
      focusedMs: 0,
      distractedMs: 0,
      uncertainMs: 0,
      idleMs: 0
    }
    let covered = 0
    let coveredUntil = hourStartMs
    for (const item of clipped) {
      const start = Math.max(hourStartMs, item.start)
      const end = Math.min(hourEndMs, item.end)
      if (end <= start) continue
      const state = sessionState(item.session)
      row.segments.push({
        session: item.session,
        state,
        startMs: start,
        endMs: end,
        offset: (start - hourStartMs) / length,
        width: (end - start) / length
      })
      // Sessions can overlap slightly when activity capture catches up; count
      // each instant once so tracked and idle time add up to the hour.
      const from = Math.max(start, coveredUntil)
      if (end > from) {
        covered += end - from
        row[`${state}Ms`] += end - from
        coveredUntil = end
      }
    }
    row.idleMs = Math.max(0, length - covered)
    return row
  })

  const sum = (key: 'focusedMs' | 'distractedMs' | 'uncertainMs' | 'idleMs') =>
    rows.reduce((total, row) => total + row[key], 0)
  return {
    startMs,
    endMs,
    rows,
    focusedMs: sum('focusedMs'),
    distractedMs: sum('distractedMs'),
    uncertainMs: sum('uncertainMs'),
    idleMs: sum('idleMs')
  }
}
