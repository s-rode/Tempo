import { ActiveWindowEvent, Category } from 'shared'

export type NotchStatus = 'productive' | 'unproductive' | 'maybe' | null

export interface StreakClock {
  /** Completed active time in this streak. Paused time is deliberately excluded. */
  accumulatedMs: number
  /** A wall-clock start time only while this clock is currently advancing. */
  runningSinceMs: number | null
}

export interface NotchTimerState {
  currentStatus: NotchStatus
  productiveClock: StreakClock
  distractedClock: StreakClock
  /** Set while a distraction can still resume the preceding productive streak. */
  provisionalDistractionStartedAtMs: number | null
  dailyProductiveMs: number
  dailyDistractedMs: number
  // Kept temporarily so older helper builds degrade safely.
  productiveStreakMs: number
  distractedStreakMs: number
  statusStartedAtMs: number | null
}

const graceMs = 60_000

const statusFor = (event: ActiveWindowEvent, categories: Map<string, Category>): NotchStatus => {
  if (!event.categoryId) return 'maybe'
  const category = categories.get(event.categoryId)
  if (!category) return 'maybe'
  return category.isProductive ? 'productive' : 'unproductive'
}

const isHardBoundary = (event: ActiveWindowEvent): boolean =>
  event.type === 'system' && /sleep|lock/i.test(`${event.ownerName || ''} ${event.title || ''}`)

type Run = { status: NotchStatus; start: number; end: number; hardBoundaryBefore: boolean }

/**
 * Builds resumable notch clocks. A distraction shorter than one minute pauses
 * productive time rather than ending it; the interrupted seconds never count
 * as focused time. Sleep and lock always terminate the session.
 */
export function deriveNotchTimerState(
  events: ActiveWindowEvent[],
  categories: Category[],
  dailyProductiveMs: number,
  dailyDistractedMs: number,
  now = Date.now()
): NotchTimerState {
  const categoryMap = new Map(categories.map((category) => [category._id, category]))
  const ordered = [...events]
    .filter((event) => Number.isFinite(event.timestamp))
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))
  const runs: Run[] = []

  for (const event of ordered) {
    const timestamp = event.timestamp || 0
    const status = statusFor(event, categoryMap)
    const previous = runs[runs.length - 1]
    if (previous && previous.status === status && !isHardBoundary(event)) continue
    if (previous) previous.end = timestamp
    runs.push({ status, start: timestamp, end: now, hardBoundaryBefore: isHardBoundary(event) })
  }

  const current = runs[runs.length - 1]
  if (!current) {
    const empty: StreakClock = { accumulatedMs: 0, runningSinceMs: null }
    return {
      currentStatus: null,
      productiveClock: empty,
      distractedClock: { ...empty },
      provisionalDistractionStartedAtMs: null,
      dailyProductiveMs,
      dailyDistractedMs,
      productiveStreakMs: 0,
      distractedStreakMs: 0,
      statusStartedAtMs: null
    }
  }

  const duration = (run: Run) => Math.max(0, run.end - run.start)
  const latestRun = (status: NotchStatus) => [...runs].reverse().find((run) => run.status === status)
  const latestProductiveIndex = runs.map((run) => run.status).lastIndexOf('productive')
  let productiveAccumulated = 0
  let productiveRunningSince: number | null = null
  let provisionalDistractionStartedAtMs: number | null = null

  if (latestProductiveIndex >= 0) {
    let startIndex = latestProductiveIndex
    for (let index = latestProductiveIndex - 1; index >= 0; index -= 1) {
      const between = runs[index + 1]
      if (between.hardBoundaryBefore || duration(between) >= graceMs) break
      if (runs[index].status === 'productive') startIndex = index
    }
    for (let index = startIndex; index < runs.length; index += 1) {
      if (runs[index].status === 'productive') productiveAccumulated += duration(runs[index])
    }
    if (current.status === 'productive') {
      const activeProductive = latestRun('productive')!
      productiveAccumulated -= duration(activeProductive)
      productiveRunningSince = activeProductive.start
    } else if (current.status === 'unproductive' && duration(current) < graceMs) {
      provisionalDistractionStartedAtMs = current.start
    }
  }

  const lastDistracted = latestRun('unproductive')
  const distractedClock: StreakClock = current.status === 'unproductive'
    ? { accumulatedMs: 0, runningSinceMs: current.start }
    : { accumulatedMs: lastDistracted ? duration(lastDistracted) : 0, runningSinceMs: null }
  const productiveClock: StreakClock = { accumulatedMs: productiveAccumulated, runningSinceMs: productiveRunningSince }
  const visibleProductive = productiveClock.accumulatedMs + (productiveClock.runningSinceMs ? now - productiveClock.runningSinceMs : 0)
  const visibleDistracted = distractedClock.accumulatedMs + (distractedClock.runningSinceMs ? now - distractedClock.runningSinceMs : 0)

  return {
    currentStatus: current.status,
    productiveClock,
    distractedClock,
    provisionalDistractionStartedAtMs,
    dailyProductiveMs,
    dailyDistractedMs,
    productiveStreakMs: Math.max(0, visibleProductive),
    distractedStreakMs: Math.max(0, visibleDistracted),
    statusStartedAtMs: current.status === 'maybe' ? null : current.start
  }
}
