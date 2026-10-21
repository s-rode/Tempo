import { describe, expect, test } from 'bun:test'
import { MAX_ACTIVITY_CONTENT_CHARACTERS } from 'shared'
import type { ActiveWindowEvent } from 'shared'
import {
  boundedActivityContent,
  FirefoxSiteIdentityCache,
  currentActivityEvent,
  failedForegroundCapture,
  type ForegroundActivityWindow
} from './activityCaptureState'
import { getDisplayWindowInfo, getStatusText } from '../utils/distractionStatusBarUIHelpers'

const firefox: ForegroundActivityWindow = {
  ownerName: 'Firefox',
  title: 'Course lecture',
  type: 'browser',
  browser: 'firefox',
  monitoringCaptureId: 'firefox-capture',
  monitoringSequence: 2
}
const previous: ActiveWindowEvent = {
  ownerName: 'WhatsApp',
  title: 'WhatsApp',
  type: 'window',
  userId: 'local',
  monitoringCaptureId: 'previous-capture',
  classificationStatus: 'insufficient_context'
}

describe('Firefox foreground capture regression', () => {
  test('retains only page-bound opaque identity after transient context is discarded', () => {
    const cache = new FirefoxSiteIdentityCache()
    cache.remember('a'.repeat(64), 'b'.repeat(64))
    expect(cache.get('a'.repeat(64))).toBe('b'.repeat(64))
    expect(cache.get('c'.repeat(64))).toBeUndefined()
    cache.remember('d'.repeat(64), 'example.invalid')
    expect(cache.get('d'.repeat(64))).toBeUndefined()
    for (let i = 0; i < 128; i++) cache.remember(i.toString(16).padStart(64, '0'), 'e'.repeat(64))
    expect(cache.get('a'.repeat(64))).toBeUndefined()
    expect(cache.get('7f'.padStart(64, '0'))).toBe('e'.repeat(64))
  })
  test('bounds 7,000-character OCR evidence to the same limit used by the server', () => {
    const ocr = 'Lecture notes '.repeat(600).slice(0, 7000)
    expect(ocr.length).toBe(7000)
    expect(boundedActivityContent(ocr)).toBe(ocr.slice(0, MAX_ACTIVITY_CONTENT_CHARACTERS))
    expect(boundedActivityContent(ocr)?.length).toBe(6500)
    expect(boundedActivityContent('🧠'.repeat(3500))?.length).toBe(6500)
    expect(boundedActivityContent(null)).toBeNull()
    expect(boundedActivityContent(undefined)).toBeUndefined()
  })

  test('a failed Firefox upload cannot reveal or recategorize the previous WhatsApp event', () => {
    const failed = failedForegroundCapture(firefox, 2)
    expect(failed?.classificationFailed).toBe(true)
    const selected = currentActivityEvent(previous, failed)
    expect(selected).toBeNull()
    expect(getDisplayWindowInfo(selected, failed).ownerName).toBe('Firefox')
    expect(getStatusText(selected, failed, null, false, false, null)).toBe(
      'Could not classify this activity'
    )
    // A retry can display comparison again, but the application never changes.
    expect(getDisplayWindowInfo(currentActivityEvent(previous, firefox), firefox).ownerName).toBe(
      'Firefox'
    )
    expect(getStatusText(null, firefox, null, false, false, null)).toBe('Comparing with your plan…')
  })

  test('an old request failure cannot replace a newer foreground capture', () => {
    const newer = { ...firefox, ownerName: 'Editor', monitoringSequence: 3 }
    expect(failedForegroundCapture(newer, 2)).toBe(newer)
    expect(newer.classificationFailed).toBeUndefined()
  })

  test('only the matching capture can supply the current decision, even on the same Firefox tab', () => {
    const stale = { ...previous, ...firefox, monitoringCaptureId: 'old-firefox-capture' }
    expect(currentActivityEvent(stale, firefox)).toBeNull()
    const committed = { ...stale, monitoringCaptureId: firefox.monitoringCaptureId }
    expect(currentActivityEvent(committed, firefox)).toBe(committed)
    expect(currentActivityEvent(committed, null)).toBe(committed)
  })
})
