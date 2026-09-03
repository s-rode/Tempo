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
  provisionalDistractionStartedAtMs: number | null
  dailyProductiveMs: number
  dailyDistractedMs: number
  productiveStreakMs: number
  distractedStreakMs: number
  statusStartedAtMs: number | null
}

const graceMs = 60_000

const emptyClock = (): StreakClock => ({ accumulatedMs: 0, runningSinceMs: null })

const statusFor = (event: ActiveWindowEvent, categories: Map<string, Category>): NotchStatus => {
  if (!event.categoryId) return 'maybe'
  const category = categories.get(event.categoryId)
  if (!category) return 'maybe'
  return category.isProductive ? 'productive' : 'unproductive'
}

const systemKind = (event: ActiveWindowEvent): 'lock' | 'unlock' | null => {
  if (event.type !== 'system') return null
  const text = `${event.ownerName || ''} ${event.title || ''}`.toLowerCase()
  if (text.includes('unlock') || text.includes('wake')) return 'unlock'
  if (text.includes('sleep') || text.includes('lock')) return 'lock'
  return null
}

/**
 * Deterministically rebuilds normal-mode timers in chronological order.
 * A productive session can only resume across its immediately preceding short
 * distraction, so it cannot reconnect to an unrelated older session.
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

  if (!ordered.length) {
    return {
      currentStatus: null,
      productiveClock: emptyClock(),
      distractedClock: emptyClock(),
      provisionalDistractionStartedAtMs: null,
      dailyProductiveMs,
      dailyDistractedMs,
      productiveStreakMs: 0,
      distractedStreakMs: 0,
      statusStartedAtMs: null
    }
  }

  let suspended = false
  let currentStatus: NotchStatus = null
  let statusStartedAt: number | null = null
  let previousTimestamp: number | null = null

  let productiveAccumulated = 0
  let productiveSessionOpen = false
  let productiveRunningSince: number | null = null
  let completedProductiveMs = 0

  let distractedAccumulated = 0
  let distractedRunningSince: number | null = null
  let completedDistractedMs = 0
  let provisionalDistractionStartedAtMs: number | null = null
  let provisionalDistractionElapsedMs = 0

  const resetForBoundary = () => {
    if (productiveSessionOpen) completedProductiveMs = productiveAccumulated
    if (distractedRunningSince !== null || distractedAccumulated > 0) {
      completedDistractedMs = distractedAccumulated
    }
    productiveAccumulated = 0
    productiveSessionOpen = false
    productiveRunningSince = null
    distractedAccumulated = 0
    distractedRunningSince = null
    provisionalDistractionStartedAtMs = null
    provisionalDistractionElapsedMs = 0
  }

  const accrue = (until: number) => {
    if (previousTimestamp === null || suspended) return
    const elapsed = Math.max(0, until - previousTimestamp)
    if (currentStatus === 'productive' && productiveSessionOpen) {
      productiveAccumulated += elapsed
    } else if (currentStatus === 'unproductive') {
      distractedAccumulated += elapsed
      provisionalDistractionElapsedMs += elapsed
    }
  }

  for (const event of ordered) {
    const timestamp = Math.min(event.timestamp || now, now)
    accrue(timestamp)

    const system = systemKind(event)
    if (system === 'lock') {
      resetForBoundary()
      suspended = true
      currentStatus = 'maybe'
      statusStartedAt = null
      previousTimestamp = timestamp
      continue
    }
    if (system === 'unlock') {
      suspended = false
      currentStatus = 'maybe'
      statusStartedAt = null
      previousTimestamp = timestamp
      continue
    }
    if (suspended) {
      previousTimestamp = timestamp
      continue
    }

    const nextStatus = statusFor(event, categoryMap)
    if (nextStatus !== currentStatus) {
      if (nextStatus === 'productive') {
        const resumesProvisionalSession =
          currentStatus === 'unproductive' &&
          productiveSessionOpen &&
          provisionalDistractionElapsedMs < graceMs
        if (!resumesProvisionalSession) {
          if (productiveSessionOpen) completedProductiveMs = productiveAccumulated
          productiveAccumulated = 0
          productiveSessionOpen = true
        }
        productiveRunningSince = timestamp
        distractedRunningSince = null
        if (distractedAccumulated > 0) completedDistractedMs = distractedAccumulated
        distractedAccumulated = 0
        provisionalDistractionStartedAtMs = null
        provisionalDistractionElapsedMs = 0
      } else if (nextStatus === 'unproductive') {
        productiveRunningSince = null
        distractedAccumulated = 0
        distractedRunningSince = timestamp
        provisionalDistractionStartedAtMs = productiveSessionOpen ? timestamp : null
        provisionalDistractionElapsedMs = 0
      } else {
        productiveRunningSince = null
        distractedRunningSince = null
      }
      currentStatus = nextStatus
      statusStartedAt = nextStatus === 'maybe' ? null : timestamp
    } else if (nextStatus === 'productive') {
      // The interval up to this repeated sample is now accumulated; only the
      // following live interval should be advanced by the helper.
      productiveRunningSince = timestamp
    } else if (nextStatus === 'unproductive') {
      distractedRunningSince = timestamp
    }
    previousTimestamp = timestamp
  }

  const liveElapsed = previousTimestamp === null || suspended ? 0 : Math.max(0, now - previousTimestamp)
  const longCurrentDistraction =
    currentStatus === 'unproductive' && provisionalDistractionElapsedMs + liveElapsed >= graceMs
  if (longCurrentDistraction && productiveSessionOpen) {
    completedProductiveMs = productiveAccumulated
    productiveAccumulated = 0
    productiveSessionOpen = false
    productiveRunningSince = null
    provisionalDistractionStartedAtMs = null
  }

  const productiveClock: StreakClock =
    currentStatus === 'productive' && productiveSessionOpen && !suspended
      ? { accumulatedMs: productiveAccumulated, runningSinceMs: productiveRunningSince }
      : { accumulatedMs: productiveSessionOpen ? productiveAccumulated : completedProductiveMs, runningSinceMs: null }
  const distractedClock: StreakClock =
    currentStatus === 'unproductive' && !suspended
      ? { accumulatedMs: distractedAccumulated, runningSinceMs: distractedRunningSince }
      : { accumulatedMs: distractedAccumulated || completedDistractedMs, runningSinceMs: null }

  const visibleProductive = productiveClock.accumulatedMs +
    (productiveClock.runningSinceMs ? Math.max(0, now - productiveClock.runningSinceMs) : 0)
  const visibleDistracted = distractedClock.accumulatedMs +
    (distractedClock.runningSinceMs ? Math.max(0, now - distractedClock.runningSinceMs) : 0)

  return {
    currentStatus: suspended ? 'maybe' : currentStatus,
    productiveClock,
    distractedClock,
    provisionalDistractionStartedAtMs:
      currentStatus === 'unproductive' && !longCurrentDistraction
        ? provisionalDistractionStartedAtMs
        : null,
    dailyProductiveMs,
    dailyDistractedMs,
    productiveStreakMs: Math.max(0, visibleProductive),
    distractedStreakMs: Math.max(0, visibleDistracted),
    statusStartedAtMs: suspended || currentStatus === 'maybe' ? null : statusStartedAt
  }
}

/**
 * Work phases deliberately do not use the normal-mode one-minute grace rule:
 * their two clocks are simply the productive and distracting time observed
 * since this phase started. The database remains the source of truth; this is
 * only the presentation reducer for the notch companion.
 */
export function deriveFocusPhaseTimerState(
  events: ActiveWindowEvent[],
  categories: Category[],
  phaseStartedAtMs: number,
  dailyProductiveMs: number,
  dailyDistractedMs: number,
  trackingActive: boolean,
  now = Date.now()
): NotchTimerState {
  const categoryMap = new Map(categories.map((category) => [category._id, category]))
  const ordered = [...events]
    .filter((event) => Number.isFinite(event.timestamp) && (event.timestamp || 0) >= phaseStartedAtMs)
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))

  let productiveMs = 0
  let distractedMs = 0
  let currentStatus: NotchStatus = null
  let previousAt = phaseStartedAtMs
  let statusStartedAtMs: number | null = null
  let frozen = !trackingActive

  for (const event of ordered) {
    const at = Math.min(event.timestamp || now, now)
    const elapsed = Math.max(0, at - previousAt)
    if (!frozen && currentStatus === 'productive') productiveMs += elapsed
    if (!frozen && currentStatus === 'unproductive') distractedMs += elapsed

    const system = systemKind(event)
    if (system === 'lock') {
      frozen = true
      currentStatus = 'maybe'
      statusStartedAtMs = null
    } else if (system === 'unlock') {
      frozen = !trackingActive
      currentStatus = 'maybe'
      statusStartedAtMs = null
    } else if (!frozen) {
      const next = statusFor(event, categoryMap)
      if (next !== currentStatus) statusStartedAtMs = at
      currentStatus = next
    }
    previousAt = at
  }

  if (!frozen && trackingActive) {
    const elapsed = Math.max(0, now - previousAt)
    if (currentStatus === 'productive') productiveMs += elapsed
    if (currentStatus === 'unproductive') distractedMs += elapsed
  }

  const productiveRunning = trackingActive && currentStatus === 'productive' ? previousAt : null
  const distractedRunning = trackingActive && currentStatus === 'unproductive' ? previousAt : null
  return {
    currentStatus,
    productiveClock: { accumulatedMs: productiveMs - (productiveRunning ? Math.max(0, now - productiveRunning) : 0), runningSinceMs: productiveRunning },
    distractedClock: { accumulatedMs: distractedMs - (distractedRunning ? Math.max(0, now - distractedRunning) : 0), runningSinceMs: distractedRunning },
    provisionalDistractionStartedAtMs: null,
    dailyProductiveMs,
    dailyDistractedMs,
    productiveStreakMs: productiveMs,
    distractedStreakMs: distractedMs,
    statusStartedAtMs
  }
}
