import { usableDistractionNudge, type DistractionNudge, type ActiveWindowEvent } from 'shared'

export const MIN_DISRUPTION_NOTIFICATION_INTERVAL_MS = 60_000

type NotificationCopy = {
  title: string
  body: string
}

const clip = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  const boundary = normalized.lastIndexOf(' ', limit - 1)
  return `${normalized.slice(0, boundary > 12 ? boundary : limit).trim()}…`
}

export function distractionNotificationIntervalMs(intervalSeconds: number | null | undefined): number {
  const parsed = Number(intervalSeconds)
  const requestedMs = Number.isFinite(parsed) ? parsed * 1_000 : MIN_DISRUPTION_NOTIFICATION_INTERVAL_MS
  return Math.max(MIN_DISRUPTION_NOTIFICATION_INTERVAL_MS, requestedMs)
}

/**
 * Uses the deferred local-model copy when it is available. The fallback is
 * intentionally direct as well, so a failed or cancelled enrichment never
 * turns a useful alert back into a vague status report.
 */
export function distractionNotificationCopy(
  event: Pick<ActiveWindowEvent, 'ownerName' | 'title' | 'activityLabel' | 'nudgeTitle' | 'nudgeBody'>,
  goal: string | null | undefined
): NotificationCopy {
  const model = usableDistractionNudge(event.nudgeTitle, event.nudgeBody)
  if (model) return { title: clip(model.title, 80), body: clip(model.body, 180) }

  const activity = clip(event.ownerName || event.activityLabel || event.title || 'this distraction', 42)
  const goalReference = goal?.trim()
    ? clip(goal, 68)
    : 'the task that matters most today'
  return {
    title: clip(`Close ${activity}`, 80),
    body: clip(
      `This is not moving ${goalReference} forward. Close ${activity} and take the next useful step now.`,
      180
    )
  }
}

export type PreparedDistractionNotification = { copy: DistractionNudge | null } | null

/** One preparation per activity/goal, including fallback after a network failure. */
export class DistractionNudgeLoader {
  private current: { key: string; promise: Promise<PreparedDistractionNotification> } | null = null

  load(key: string, prepare: () => Promise<PreparedDistractionNotification>) {
    if (this.current?.key === key) return this.current.promise
    const promise = Promise.resolve().then(prepare).catch(() => ({ copy: null }))
    this.current = { key, promise }
    return promise
  }
}
