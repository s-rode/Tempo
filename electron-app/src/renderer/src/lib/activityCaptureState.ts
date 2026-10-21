import { MAX_ACTIVITY_CONTENT_CHARACTERS } from 'shared'
import type { ActiveWindowDetails, ActiveWindowEvent } from 'shared'

/** Renderer-only failure state; the detected foreground identity survives a failed upload. */
export interface ForegroundActivityWindow extends ActiveWindowDetails {
  classificationFailed?: boolean
}

export function boundedActivityContent(content: string | null | undefined) {
  return content?.slice(0, MAX_ACTIVITY_CONTENT_CHARACTERS) ?? content
}

export function failedForegroundCapture(
  current: ForegroundActivityWindow | null,
  sequence: number
): ForegroundActivityWindow | null {
  return current?.monitoringSequence === sequence
    ? { ...current, classificationFailed: true }
    : current
}

/** A previous app's saved decision cannot supply the current app's category or controls. */
export function currentActivityEvent(
  event: ActiveWindowEvent | null | undefined,
  foreground: ForegroundActivityWindow | null
): ActiveWindowEvent | null | undefined {
  if (!foreground || !event) return event
  if (foreground.monitoringCaptureId)
    return event.monitoringCaptureId === foreground.monitoringCaptureId ? event : null
  return event.ownerName === foreground.ownerName &&
    event.title === foreground.title &&
    event.browser === foreground.browser &&
    event.type === foreground.type
    ? event
    : null
}
