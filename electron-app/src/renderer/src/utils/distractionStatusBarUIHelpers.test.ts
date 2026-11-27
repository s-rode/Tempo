import { describe, expect, test } from 'bun:test'
import type { ActiveWindowDetails, ActiveWindowEvent } from 'shared'
import { getDisplayWindowInfo, getStatusText } from './distractionStatusBarUIHelpers'

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
      'Local AI could not complete this comparison'
    )
  })

  test('shows local analysis only for a genuinely new foreground activity', () => {
    expect(
      getStatusText(failedEvent, { ...activity, title: 'New activity' }, null, false, false, null)
    ).toBe('Comparing with your plan…')
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
    ).toBe('Needs more context')
  })

  test('names the local rule behind a policy override', () => {
    const override = (classificationBasis: ActiveWindowEvent['classificationBasis']) =>
      getStatusText(
        { ...failedEvent, classificationStatus: 'policy_override', classificationBasis },
        null,
        null,
        false,
        false,
        null
      )
    expect(override('tool_role')).toBe('Focused · this tool fits the task’s method')
    expect(override('task_preference')).toBe('Focused · matches your correction for this task')
    expect(override(null)).toBe('Focused · learned from a similar correction')
  })
})

describe('display window info', () => {
  test('uses the shared label for system events', () => {
    expect(
      getDisplayWindowInfo(null, { ownerName: 'System Lock', title: 'System Lock', type: 'system' })
    ).toEqual({
      ownerName: '🔒 Screen Locked',
      title: 'Screen was locked',
      url: undefined,
      isApp: true
    })
  })

  test('does not treat inherited object keys as system events', () => {
    expect(
      getDisplayWindowInfo(null, { ...activity, ownerName: 'toString', browser: null })
    ).toEqual({
      ownerName: 'toString',
      title: activity.title,
      url: undefined,
      isApp: true
    })
  })
})
