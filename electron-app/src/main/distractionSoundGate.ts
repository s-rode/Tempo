// Bundle this runtime helper into the Electron main process; do not leave a
// CommonJS require of the ESM workspace package in the installed application.
import { clampDistractionSoundInterval, type DistractionSoundPermit } from '../../../shared/distractionSound'

/** Global cooldown: capture churn and renderer remounts cannot create extra sounds. */
export class DistractionSoundGate {
  private lastPlayedAtMs: number | null = null

  claim(intervalMs: number, now = performance.now()): DistractionSoundPermit {
    const interval = clampDistractionSoundInterval(intervalMs)
    const remaining =
      this.lastPlayedAtMs === null ? 0 : interval - Math.max(0, now - this.lastPlayedAtMs)
    if (remaining > 0) return { allowed: false, retryAfterMs: remaining }
    this.lastPlayedAtMs = now
    return { allowed: true, retryAfterMs: interval }
  }
}
