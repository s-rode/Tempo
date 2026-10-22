import type { FloatingStatusUpdate } from './notchHelper'

/** Materialize once at suspension; clearing the pause must never revive old starts. */
export function freezeNotchClocks(status: FloatingStatusUpdate, at: number): FloatingStatusUpdate {
  const result = { ...status }
  for (const key of ['productiveClock', 'distractedClock', 'dailyProductiveClock', 'dailyUnproductiveClock'] as const) {
    const clock = status[key]
    if (clock) result[key] = {
      accumulatedMs: clock.accumulatedMs + (clock.runningSinceMs === null ? 0 : Math.max(0, at - clock.runningSinceMs)),
      runningSinceMs: null
    }
  }
  if (status.phaseRemainingMs != null && status.phaseRemainingSampledAtMs != null) {
    const advancing = status.trackingState === 'active' || status.trackingState === 'break'
    result.phaseRemainingMs = Math.max(0, status.phaseRemainingMs - (advancing ? Math.max(0, at - status.phaseRemainingSampledAtMs) : 0))
    result.phaseRemainingSampledAtMs = at
  }
  return result
}
