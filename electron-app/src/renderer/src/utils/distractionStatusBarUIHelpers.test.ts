import { describe, expect, test } from 'bun:test'
import type { ActiveWindowDetails, ActiveWindowEvent } from 'shared'
import { getStatusText } from './distractionStatusBarUIHelpers'

const activity: ActiveWindowDetails = {
  ownerName: 'Firefox',
  title: 'Quant Interview Questions - OpenQuant',
  type: 'browser',
  browser: 'firefox'
}

const failedEvent: ActiveWindowEvent = {
  ...activity,
  userId: 'local-user',
  classificationStatus: 'invalid_response',
  categoryId: null
}

describe('current activity status', () => {
  test('shows a persisted failure instead of pretending the same activity is still classifying', () => {
    expect(getStatusText(failedEvent, activity, null, false, false, null)).toBe(
      'Local AI could not decide this activity'
    )
  })

  test('shows local analysis only for a genuinely new foreground activity', () => {
    expect(
      getStatusText(failedEvent, { ...activity, title: 'New activity' }, null, false, false, null)
    ).toBe('Analyzing locally…')
  })

  test('uses neutral wording for insufficient evidence on every app', () => {
    expect(
      getStatusText(
        { ...failedEvent, classificationStatus: 'insufficient_context' },
        null,
        null,
        false,
        false,
        null
      )
    ).toBe('Not enough evidence to decide')
  })
})
