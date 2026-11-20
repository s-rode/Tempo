import { randomUUID } from 'crypto'
import type { SystemBoundary } from './systemBoundaryJournal'

/**
 * Activity is recorded only when the frontmost window changes, so the last
 * window of a session stays open until something follows it. Sleep and lock
 * close it, but quitting Tempo, shutting down or a crash record nothing, and
 * that window would then be counted for hours (up to the 4 hour ceiling),
 * across midnight into the next day.
 *
 * Tempo therefore keeps a small "still running" marker on disk while it
 * monitors. A clean stop closes the session immediately; a marker left behind
 * by a launch that never stopped cleanly closes it at the last time Tempo was
 * known to be running.
 */
export const LIVENESS_INTERVAL_MS = 60_000

export interface LivenessMarker {
  aliveAtMs: number
}

export const parseLivenessMarker = (raw: string | null): LivenessMarker | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const aliveAtMs = parsed?.aliveAtMs
    return typeof aliveAtMs === 'number' && Number.isFinite(aliveAtMs) && aliveAtMs > 0
      ? { aliveAtMs }
      : null
  } catch {
    return null
  }
}

/** The boundary that closes the previous launch, if it did not stop cleanly. */
export const boundaryForUncleanExit = (
  marker: LivenessMarker | null,
  nowMs: number,
  id: () => string = randomUUID
): SystemBoundary | null =>
  marker ? { captureId: id(), kind: 'stop', timestamp: Math.min(marker.aliveAtMs, nowMs) } : null

export const stopBoundary = (nowMs: number, id: () => string = randomUUID): SystemBoundary => ({
  captureId: id(),
  kind: 'stop',
  timestamp: nowMs
})
