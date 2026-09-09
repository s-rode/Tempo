export const MIN_DISTRACTION_REMINDER_INTERVAL_MS = 60_000
export const MAX_DISTRACTION_REMINDER_INTERVAL_MS = 600_000

/**
 * The renderer schedules reminders for responsiveness, but this small
 * main-process guard is the final authority. It survives a renderer reload
 * and retains only opaque event keys plus timestamps.
 */
export class DistractionReminderGate {
  private readonly lastDeliveryByEventKey = new Map<string, number>()

  shouldDeliver(eventKey: string, intervalMs: number, now = Date.now()): boolean {
    const minimumIntervalMs = clampDistractionReminderInterval(intervalMs)
    const previous = this.lastDeliveryByEventKey.get(eventKey)
    if (previous !== undefined && now - previous < minimumIntervalMs) return false

    this.lastDeliveryByEventKey.set(eventKey, now)
    if (this.lastDeliveryByEventKey.size > 128) {
      const oldest = this.lastDeliveryByEventKey.keys().next().value
      if (oldest) this.lastDeliveryByEventKey.delete(oldest)
    }
    return true
  }
}

export function clampDistractionReminderInterval(value: number): number {
  if (!Number.isFinite(value)) return MIN_DISTRACTION_REMINDER_INTERVAL_MS
  return Math.min(
    MAX_DISTRACTION_REMINDER_INTERVAL_MS,
    Math.max(MIN_DISTRACTION_REMINDER_INTERVAL_MS, Math.round(value))
  )
}
