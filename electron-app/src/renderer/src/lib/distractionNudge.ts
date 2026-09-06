import type { ActiveWindowEvent } from 'shared'

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

const hasUsefulLocalNudge = (title: string, body: string): boolean => {
  const normalized = `${title} ${body}`.toLocaleLowerCase()
  return !(
    normalized.includes('currently marked as distracting') ||
    normalized.startsWith('return to:') ||
    normalized.includes('distraction: distracting')
  )
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
  const modelTitle = event.nudgeTitle?.trim() || ''
  const modelBody = event.nudgeBody?.trim() || ''
  if (modelTitle && modelBody && hasUsefulLocalNudge(modelTitle, modelBody)) {
    return { title: clip(modelTitle, 80), body: clip(modelBody, 180) }
  }

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
